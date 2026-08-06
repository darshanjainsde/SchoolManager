import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import type { User, UserRole } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from './password.service';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Look up by (schoolId, identifier), where identifier is an email address,
   * a login username, or a student admission number (web-first portals,
   * Phase 2A). User row lookup uses the platform connection because we have
   * not yet established the request's tenant scope from a JWT; the schoolId
   * is trusted because it comes from the tenant-resolved Host.
   */
  async login(schoolId: string, identifier: string, password: string): Promise<IssuedTokens> {
    const platform = getPlatformPrisma();
    const user = identifier.includes('@')
      ? await platform.user.findUnique({
          where: { schoolId_email: { schoolId, email: identifier.toLowerCase() } },
        })
      : await this.resolveUserByUsernameOrAdmissionNo(platform, schoolId, identifier);
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account temporarily locked');
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      await this.recordFailedAttempt(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login — reset counters and issue a fresh token family.
    await platform.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.issueTokens(user, randomUUID(), schoolId);
  }

  async refresh(rawToken: string): Promise<IssuedTokens> {
    let payload: { sub: string; jti: string; fam: string; schoolId: string };
    try {
      payload = this.jwt.verify(rawToken, {
        secret: this.env.JWT_SCHOOL_REFRESH_SECRET,
        audience: 'school-refresh',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = sha256(rawToken);

    // Reuse detection runs in its own committed transaction so a throw can't
    // roll back the family-wide revocation. Only after that's persisted do we
    // surface the 401.
    const existing0 = await withTenant(payload.schoolId, async (tx) =>
      tx.refreshToken.findUnique({ where: { tokenHash } }),
    );
    if (!existing0 || existing0.revokedAt) {
      if (existing0) {
        await withTenant(payload.schoolId, async (tx) => {
          await tx.refreshToken.updateMany({
            where: { familyId: existing0.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        });
      }
      throw new UnauthorizedException('Refresh token reuse detected — session terminated');
    }

    // Happy path: rotate inside a single tenant-scoped transaction (defeats races).
    return withTenant(payload.schoolId, async (tx) => {
      const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!existing || existing.revokedAt) {
        // Lost a race with the reuse detector above — re-check and reject.
        throw new UnauthorizedException('Refresh token reuse detected — session terminated');
      }
      if (existing.expiresAt < new Date()) {
        throw new UnauthorizedException('Refresh token expired');
      }

      const user = await tx.user.findUnique({ where: { id: existing.userId } });
      if (!user || !user.isActive) throw new UnauthorizedException('User no longer active');

      // Mint new tokens within the same family, mark the old one revoked.
      const newJti = randomUUID();
      const newRefresh = this.signRefresh({
        sub: user.id,
        jti: newJti,
        fam: existing.familyId,
        schoolId: payload.schoolId,
      });

      const newHash = sha256(newRefresh);
      const newRow = await tx.refreshToken.create({
        data: {
          schoolId: payload.schoolId,
          userId: user.id,
          familyId: existing.familyId,
          tokenHash: newHash,
          expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
        },
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedById: newRow.id },
      });

      const accessToken = this.signAccess(user, payload.schoolId);
      return { accessToken, refreshToken: newRefresh, expiresIn: this.env.JWT_ACCESS_TTL };
    });
  }

  /**
   * Exchanges a single-use owner-minted impersonation token for a short-lived
   * school-admin session. No refresh token is issued — the session hard-ends
   * when the access token expires, and the `imp` claim lets the UI show an
   * "Owner view" banner.
   */
  async impersonate(schoolId: string, rawToken: string): Promise<{ accessToken: string; expiresIn: number; impersonated: true }> {
    const db = getPlatformPrisma();
    const row = await db.impersonationToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    const invalid =
      !row ||
      row.usedAt !== null ||
      row.expiresAt < new Date() ||
      row.schoolId !== schoolId ||
      !row.user.isActive;
    if (invalid) throw new UnauthorizedException('This impersonation link is invalid or has expired');

    // Burn before issuing: a raced second exchange must lose.
    const burned = await db.impersonationToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count === 0) throw new UnauthorizedException('This impersonation link is invalid or has expired');

    const payload: Omit<SchoolJwtPayload, 'iat' | 'exp'> = {
      sub: row.user.id,
      aud: 'school',
      schoolId,
      role: row.user.role,
      jti: randomUUID(),
      imp: true,
    };
    const accessToken = this.jwt.sign(payload, {
      secret: this.env.JWT_SCHOOL_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });
    this.logger.warn(`Impersonation session started for user ${row.user.id} (school ${schoolId})`);
    return { accessToken, expiresIn: this.env.JWT_ACCESS_TTL, impersonated: true };
  }

  async logout(schoolId: string, rawToken: string): Promise<void> {
    const hash = sha256(rawToken);
    await withTenant(schoolId, async (tx) => {
      await tx.refreshToken.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }).catch(() => undefined);
  }

  private async issueTokens(user: User, familyId: string, schoolId: string): Promise<IssuedTokens> {
    const accessToken = this.signAccess(user, schoolId);
    const refreshToken = this.signRefresh({
      sub: user.id,
      jti: randomUUID(),
      fam: familyId,
      schoolId,
    });

    // Persist refresh-token hash so we can detect reuse.
    await withTenant(schoolId, (tx) =>
      tx.refreshToken.create({
        data: {
          schoolId,
          userId: user.id,
          familyId,
          tokenHash: sha256(refreshToken),
          expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
        },
      }),
    );

    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL };
  }

  private signAccess(user: User, schoolId: string): string {
    const payload: Omit<SchoolJwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      aud: 'school',
      schoolId,
      role: user.role,
      jti: randomUUID(),
    };
    return this.jwt.sign(payload, {
      secret: this.env.JWT_SCHOOL_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });
  }

  private signRefresh(p: { sub: string; jti: string; fam: string; schoolId: string }): string {
    return this.jwt.sign(p, {
      secret: this.env.JWT_SCHOOL_REFRESH_SECRET,
      audience: 'school-refresh',
      expiresIn: this.env.JWT_REFRESH_TTL,
    });
  }

  /**
   * Non-email identifiers can be a login username (students or teachers may
   * have one) or a student admission number. Username is tried first —
   * cheap, direct lookup — then falls through to the admission-number path.
   * Either miss falls through to the SAME generic "Invalid credentials" the
   * caller already throws for a null result — no enumeration either way.
   */
  private async resolveUserByUsernameOrAdmissionNo(
    platform: ReturnType<typeof getPlatformPrisma>,
    schoolId: string,
    identifier: string,
  ): Promise<User | null> {
    // A code-shaped identifier (RAF-00042, Phase 5·1) resolves via the
    // student code first — then falls through to the older paths, so a
    // username that merely LOOKS like a code still works. Same
    // null-not-throw contract as the other resolvers: no enumeration.
    if (/^[A-Za-z]{3}-\d{5,}$/.test(identifier)) {
      const byCode = await this.resolveUserByStudentCode(platform, schoolId, identifier);
      if (byCode) return byCode;
    }
    const byUsername = await platform.user.findFirst({
      where: { schoolId, username: { equals: identifier, mode: 'insensitive' } },
    });
    if (byUsername) return byUsername;
    return this.resolveUserByAdmissionNo(platform, schoolId, identifier);
  }

  /** Resolves a student's linked User by their RAF-00042 code (case-insensitive). */
  private async resolveUserByStudentCode(
    platform: ReturnType<typeof getPlatformPrisma>,
    schoolId: string,
    code: string,
  ): Promise<User | null> {
    const student = await platform.student.findFirst({
      where: { schoolId, code: { equals: code, mode: 'insensitive' } },
    });
    if (!student?.userId) return null;
    return platform.user.findUnique({ where: { id: student.userId } });
  }

  /**
   * Resolves a student's linked User by admission number (case-insensitive).
   * Returns null (never throws) for an unknown admission number or a student
   * with no linked account, so the caller can fall through to the same
   * generic "Invalid credentials" response used for the email path — no
   * enumeration of which admission numbers exist.
   */
  private async resolveUserByAdmissionNo(
    platform: ReturnType<typeof getPlatformPrisma>,
    schoolId: string,
    admissionNo: string,
  ): Promise<User | null> {
    const student = await platform.student.findFirst({
      where: { schoolId, admissionNo: { equals: admissionNo, mode: 'insensitive' } },
    });
    if (!student?.userId) return null;
    return platform.user.findUnique({ where: { id: student.userId } });
  }

  private async recordFailedAttempt(user: User): Promise<void> {
    const next = user.failedLoginAttempts + 1;
    const lock =
      next >= this.env.LOCKOUT_MAX_ATTEMPTS
        ? new Date(Date.now() + this.env.LOCKOUT_DURATION_SECONDS * 1000)
        : null;
    await getPlatformPrisma().user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: next, lockedUntil: lock },
    });
    if (lock) {
      this.logger.warn(`User ${user.id} locked for ${this.env.LOCKOUT_DURATION_SECONDS}s`);
    }
  }

  /**
   * THE PERSON'S OWN NAME, for greeting them by it.
   *
   * `User` carries credentials, not identity — it has an email and a username
   * and no name column at all. With nothing better to hand, the app stored
   * whatever was typed into the login box and greeted teachers with their own
   * email address across the top of the home screen.
   *
   * The name lives on whichever role record points back at the user. The role
   * on the JWT says which table to read, but it is only a hint: an account can
   * be re-roled, and a SCHOOL_ADMIN is usually a Staff row. So the hinted table
   * is tried first and the others after, rather than trusting the hint alone
   * and returning nothing.
   *
   * Returns null when no role record claims the user — a real state for a fresh
   * admin invited by email before any staff record exists. Callers must render
   * something sensible instead of the word "null".
   */
  async displayNameFor(schoolId: string, userId: string, role: UserRole): Promise<string | null> {
    const platform = getPlatformPrisma();
    const where = { schoolId, userId };
    const select = { firstName: true, lastName: true } as const;

    const lookups: Record<'TEACHER' | 'STUDENT' | 'STAFF', () => Promise<Named | null>> = {
      TEACHER: () => platform.teacher.findFirst({ where, select }),
      STUDENT: () => platform.student.findFirst({ where, select }),
      STAFF: () => platform.staff.findFirst({ where, select }),
    };
    type Table = keyof typeof lookups;
    const hinted: Table = role === 'TEACHER' || role === 'STUDENT' ? role : 'STAFF';
    const order: Table[] = [
      hinted,
      ...(['TEACHER', 'STUDENT', 'STAFF'] as const).filter((k) => k !== hinted),
    ];

    for (const key of order) {
      const rec = await lookups[key]();
      if (rec) {
        const full = `${rec.firstName} ${rec.lastName}`.trim();
        if (full) return full;
      }
    }
    return null;
  }
}

interface Named {
  firstName: string;
  lastName: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
