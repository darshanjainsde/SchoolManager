import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PasswordService } from '../../auth';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';

/**
 * The alumnus's door.
 *
 * There is no password. The link IS the credential — signed, single-use,
 * expiring, tied to one Alumni row. See the migration header for why.
 *
 * Three properties this file is responsible for, each of which is easy to get
 * wrong quietly:
 *
 *  1. Only the sha256 hash is ever stored. A database dump must not hand
 *     anybody a working key.
 *  2. A CLAIM token is single-use, and the swap for a SESSION token happens in
 *     ONE transaction with a conditional update, so two people racing the same
 *     link cannot both get a session.
 *  3. Redeeming a token proves possession of a link. It does NOT prove
 *     identity, and it never promotes anybody: `status` and
 *     `trustedForStudents` are only ever moved by a human in the office.
 */

/** 30 minutes. Long enough to walk from the gate to a phone; short enough that
 *  a link forwarded into a group chat is stale before it spreads. */
const CLAIM_TTL_MS = 30 * 60 * 1000;

/** 90 days. Deliberately long — a returning alumnus should never authenticate
 *  twice in a term, and the session buys almost nothing on its own. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** 32 bytes of CSPRNG, base64url. Not a uuid: a uuid is 122 bits with structure
 *  and is generated for readability, not for being unguessable. */
function mintRaw(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface AlumniIdentity {
  alumniId: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  batchYear: number;
  status: string;
  trustedForStudents: boolean;
}

/** Readable aloud over a phone and unambiguous in handwriting: no O/0, I/l/1.
 *  The office reads this to somebody, or pastes it into WhatsApp. */
function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('').replace(/(.{5})/, '$1-');
}

@Injectable()
export class AlumniAuthService {
  private readonly logger = new Logger(AlumniAuthService.name);

  // Explicit @Inject: tsx does not reliably emit design:paramtypes, and a bare
  // typed constructor parameter can resolve to undefined (LIBRARY-TRAPS #6).
  constructor(@Inject(PasswordService) private readonly passwords: PasswordService) {}

  /**
   * Mint a claim link for one alumnus. Returns the RAW token exactly once —
   * it is never readable again, because only the hash is stored.
   */
  async mintClaimToken(schoolId: string, alumniId: string): Promise<{ token: string; expiresAt: Date }> {
    return withTenant(schoolId, async (tx) => {
      const alum = await tx.alumni.findFirst({
        where: { id: alumniId, schoolId },
        select: { id: true, status: true },
      });
      if (!alum) throw new ApiError('ALUMNI_NOT_FOUND', 'No such alumni record.', 404);
      if (alum.status === 'DECLINED' || alum.status === 'HIDDEN') {
        throw new ApiError(
          'ALUMNI_NOT_INVITABLE',
          'That record is declined or hidden, so it cannot be sent a link.',
          409,
        );
      }

      // Supersede any live claim link for this person. Two working links for
      // one alumnus means the older one keeps working after the newer is used,
      // which is exactly the surprise nobody debugs at the time.
      await tx.alumniAccessToken.updateMany({
        where: { schoolId, alumniId, kind: 'CLAIM', usedAt: null },
        data: { usedAt: new Date() },
      });

      const raw = mintRaw();
      const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
      await tx.alumniAccessToken.create({
        data: { schoolId, alumniId, tokenHash: sha256(raw), kind: 'CLAIM', expiresAt },
      });
      return { token: raw, expiresAt };
    });
  }

  /**
   * Swap a claim link for a 90-day device session.
   *
   * The claim token is marked used INSIDE the same transaction with a
   * conditional `updateMany` on `usedAt: null`. If two requests race the same
   * link, exactly one sees `count === 1` and the other is refused — a read,
   * then a write, would let both through under READ COMMITTED. That is the
   * fourth-most-repeated mistake on this project and it is not repeated here.
   */
  async redeemClaim(schoolId: string, rawToken: string): Promise<{ session: string; expiresAt: Date; alumni: AlumniIdentity }> {
    const hash = sha256(rawToken);
    return withTenant(schoolId, async (tx) => {
      const row = await tx.alumniAccessToken.findFirst({
        where: { tokenHash: hash, schoolId, kind: 'CLAIM' },
        select: { id: true, alumniId: true, expiresAt: true, usedAt: true },
      });
      // One message for every failure. "Expired" vs "already used" vs "never
      // existed" tells somebody probing links which of the three they hit.
      const refuse = () =>
        new ApiError('ALUMNI_LINK_INVALID', 'That link is not valid any more. Ask for a new one.', 401);
      if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw refuse();

      const claimed = await tx.alumniAccessToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw refuse();

      const alum = await tx.alumni.findFirst({
        where: { id: row.alumniId, schoolId },
        select: {
          id: true, schoolId: true, firstName: true, lastName: true,
          batchYear: true, status: true, trustedForStudents: true,
        },
      });
      if (!alum) throw refuse();

      // Redeeming proves possession of a link. It does NOT promote anybody:
      // a PENDING alumnus stays PENDING and sees nothing until the office
      // matches them against the register.
      const raw = mintRaw();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await tx.alumniAccessToken.create({
        data: { schoolId, alumniId: alum.id, tokenHash: sha256(raw), kind: 'SESSION', expiresAt },
      });

      return {
        session: raw,
        expiresAt,
        alumni: {
          alumniId: alum.id,
          schoolId: alum.schoolId,
          firstName: alum.firstName,
          lastName: alum.lastName,
          batchYear: alum.batchYear,
          status: alum.status,
          trustedForStudents: alum.trustedForStudents,
        },
      };
    });
  }

  /**
   * Resolve a session token to an identity, or null.
   *
   * Returns null rather than throwing so the guard decides the status code —
   * a resolver that throws its own 401 makes every caller's error handling a
   * guess.
   */
  async resolveSession(schoolId: string, rawToken: string): Promise<AlumniIdentity | null> {
    if (!rawToken || rawToken.length < 16 || rawToken.length > 512) return null;
    const hash = sha256(rawToken);
    return withTenant(schoolId, async (tx) => {
      const row = await tx.alumniAccessToken.findFirst({
        where: { tokenHash: hash, schoolId, kind: 'SESSION' },
        select: {
          expiresAt: true,
          usedAt: true,
          alumni: {
            select: {
              id: true, schoolId: true, firstName: true, lastName: true,
              batchYear: true, status: true, trustedForStudents: true, isDeceased: true,
            },
          },
        },
      });
      if (!row || row.usedAt) return null;
      if (row.expiresAt.getTime() < Date.now()) return null;
      const a = row.alumni;
      // Re-read on EVERY request rather than trusting what the token was minted
      // with. The office un-verifying somebody, hiding them, or marking them
      // deceased has to take effect on their next request — not in ninety days.
      if (!a || a.status !== 'VERIFIED' || a.isDeceased) return null;
      return {
        alumniId: a.id,
        schoolId: a.schoolId,
        firstName: a.firstName,
        lastName: a.lastName,
        batchYear: a.batchYear,
        status: a.status,
        trustedForStudents: a.trustedForStudents,
      };
    });
  }

  /** Sign out this device. Other devices keep their sessions. */
  async revokeSession(schoolId: string, rawToken: string): Promise<void> {
    const hash = sha256(rawToken);
    await withTenant(schoolId, (tx) =>
      tx.alumniAccessToken.updateMany({
        where: { schoolId, tokenHash: hash, kind: 'SESSION', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ).catch(() => undefined);
  }

  /** Every device, for when the office withdraws somebody's access. */
  async revokeAllSessions(schoolId: string, alumniId: string): Promise<number> {
    return withTenant(schoolId, async (tx) => {
      const r = await tx.alumniAccessToken.updateMany({
        where: { schoolId, alumniId, kind: 'SESSION', usedAt: null },
        data: { usedAt: new Date() },
      });
      return r.count;
    });
  }

  /** Kept for the day a token value is compared outside an index lookup.
   *  Equality on secrets is constant-time or it is a timing oracle. */
  static safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  // ─── Accounts: the ordinary login, for people who want one ─────────────────

  /**
   * The office gives a verified alumnus a real account.
   *
   * Deliberately NOT the student flow, which mints an unusable placeholder and
   * emails an invite link: email does not work here yet, so an invite would
   * simply never arrive. This returns a readable temporary password ONCE, for
   * the office to hand over the way it hands over everything else — a WhatsApp
   * message to the batch group.
   *
   * The link door stays. This is for the alumnus who wants a password, and for
   * the batch captain who opens this weekly.
   */
  /**
   * Resolve an alumnus from an ordinary school login.
   *
   * The third door. An alumnus with an account can sign in at the school's
   * normal `/login` like everybody else; that issues a school JWT, not an
   * AlumniAccessToken, so without this the alumni routes would refuse the very
   * session the login just created and send them round to sign in twice.
   *
   * The same freshness rule as `resolveSession` applies, and for the same
   * reason: VERIFIED is a standing status the office can withdraw, never
   * something a token carries for its lifetime.
   */
  async resolveSchoolUser(schoolId: string, userId: string): Promise<AlumniIdentity | null> {
    return withTenant(schoolId, async (tx) => {
      const a = await tx.alumni.findFirst({
        where: { schoolId, userId, status: 'VERIFIED', isDeceased: false },
        select: {
          id: true, schoolId: true, firstName: true, lastName: true,
          batchYear: true, status: true, trustedForStudents: true,
        },
      });
      if (!a) return null;
      return {
        alumniId: a.id,
        schoolId: a.schoolId,
        firstName: a.firstName,
        lastName: a.lastName,
        batchYear: a.batchYear,
        status: a.status,
        trustedForStudents: a.trustedForStudents,
      };
    });
  }

  async createAccount(schoolId: string, alumniId: string, email: string) {
    const clean = email.trim().toLowerCase();
    return withTenant(schoolId, async (tx) => {
      const alum = await tx.alumni.findFirst({ where: { id: alumniId, schoolId } });
      if (!alum) throw new NotFoundException('Alumni record not found');
      if (alum.status !== 'VERIFIED') {
        throw new ApiError(
          'MUST_BE_VERIFIED_FIRST',
          'Only a verified alumnus can be given an account.',
          409,
        );
      }
      if (alum.userId) throw new ConflictException('That alumnus already has a login');

      const raw = tempPassword();
      const passwordHash = await this.passwords.hash(raw);
      const user = await tx.user.create({
        data: { schoolId, email: clean, passwordHash, role: 'ALUMNUS' },
      });
      await tx.alumni.update({
        where: { id: alumniId },
        data: { userId: user.id, email: alum.email ?? clean },
      });
      // Shown once. Nothing stores it, and there is no way to read it back.
      return { email: clean, tempPassword: raw };
    });
  }

  /**
   * Sign in with an email and a password, and get the SAME session a claim link
   * would have given.
   *
   * One session concept, deliberately. Issuing a school JWT here would mean two
   * parallel credentials for one person and a guard that has to understand
   * both; instead the password is simply another way to earn an
   * AlumniAccessToken, and everything downstream is unchanged.
   */
  async loginWithPassword(schoolId: string, email: string, password: string) {
    const refuse = () =>
      new ApiError('ALUMNI_LOGIN_INVALID', 'That email and password do not match.', 401);
    return withTenant(schoolId, async (tx) => {
      // Two lookups, not a join: Alumni.userId is a plain scalar with no Prisma
      // relation, deliberately — deleting a User must not cascade an alumni
      // record out of the school's roll.
      const user = await tx.user.findFirst({
        where: {
          schoolId,
          role: 'ALUMNUS',
          email: { equals: email.trim().toLowerCase(), mode: 'insensitive' },
        },
        select: { id: true, passwordHash: true },
      });
      // One message for "no such account", "wrong password" and "not verified
      // yet" alike. Three messages is an oracle for who has an account here.
      if (!user?.passwordHash) throw refuse();
      if (!(await this.passwords.verify(user.passwordHash, password))) throw refuse();

      const alum = await tx.alumni.findFirst({
        where: { schoolId, userId: user.id, status: 'VERIFIED', isDeceased: false },
        select: {
          id: true, schoolId: true, firstName: true, lastName: true,
          batchYear: true, status: true, trustedForStudents: true,
        },
      });
      // The password was right, but the office has since un-verified them or
      // marked them deceased. Same refusal — the account is not a standing
      // grant, the VERIFIED status is.
      if (!alum) throw refuse();

      const raw = mintRaw();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await tx.alumniAccessToken.create({
        data: { schoolId, alumniId: alum.id, tokenHash: sha256(raw), kind: 'SESSION', expiresAt },
      });
      return {
        session: raw,
        expiresAt,
        alumni: {
          alumniId: alum.id,
          schoolId: alum.schoolId,
          firstName: alum.firstName,
          lastName: alum.lastName,
          batchYear: alum.batchYear,
          status: alum.status,
          trustedForStudents: alum.trustedForStudents,
        },
      };
    });
  }

  /** An alumnus changes their own password. Requires the current one, so a
   *  borrowed 90-day session cannot lock the owner out of their own account. */
  async changePassword(schoolId: string, alumniId: string, current: string, next: string) {
    return withTenant(schoolId, async (tx) => {
      const alum = await tx.alumni.findFirst({
        where: { id: alumniId, schoolId },
        select: { userId: true },
      });
      if (!alum?.userId) {
        throw new ApiError('NO_ALUMNI_ACCOUNT', 'You do not have a password yet.', 409);
      }
      const user = await tx.user.findFirst({
        where: { id: alum.userId, schoolId },
        select: { passwordHash: true },
      });
      if (!user?.passwordHash) {
        throw new ApiError('NO_ALUMNI_ACCOUNT', 'You do not have a password yet.', 409);
      }
      if (!(await this.passwords.verify(user.passwordHash, current))) {
        throw new ApiError('ALUMNI_LOGIN_INVALID', 'That is not your current password.', 401);
      }
      await tx.user.update({
        where: { id: alum.userId },
        data: { passwordHash: await this.passwords.hash(next) },
      });
      return { ok: true };
    });
  }
}
