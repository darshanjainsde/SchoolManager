import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordService } from './password.service';

export interface AuthUserRow {
  id: string; orgId: string; role: string; branchIds: string[];
  passwordHash: string; active: boolean; failedAttempts: number; lockedUntil: Date | null;
}

export interface AuthStore {
  findByIdentifier(orgId: string, identifier: string): Promise<AuthUserRow | null>;
  recordFailure(userId: string): Promise<void>;
  recordSuccess(userId: string): Promise<void>;
}

export interface TokenIssuer {
  signAccess(user: AuthUserRow): string;
  issueRefresh(user: AuthUserRow): Promise<string>;
}

/** One message and one shape for every failure — never reveal which half was wrong. */
const GENERIC = 'Invalid credentials';

/**
 * Timing-oracle mitigation. Never a real password. Hashed once, lazily, and
 * memoized at module scope — every rejection path below pays exactly one
 * argon2id verify, the same cost a genuine wrong-password check pays, so an
 * attacker cannot learn "identifier doesn't exist" / "account is locked" /
 * "account is deactivated" apart from "password is wrong" by timing alone.
 * The `passwords.verify` call below is never optimised away: its (discarded)
 * result still has to be produced before `login` can throw.
 */
const DUMMY_PASSWORD = 'skoolos-library-timing-oracle-dummy';
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= argon2.hash(DUMMY_PASSWORD, { type: argon2.argon2id });
  return dummyHash;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenIssuer,
  ) {}

  async login(orgId: string, identifier: string, password: string) {
    const user = await this.store.findByIdentifier(orgId, identifier);
    const locked = !!user?.lockedUntil && user.lockedUntil.getTime() > Date.now();

    if (!user || !user.active || locked) {
      // Same argon2 cost as the genuine-user path below, against a fixed
      // dummy hash instead of a real one — see getDummyHash() above.
      await this.passwords.verify(await getDummyHash(), password);
      throw new UnauthorizedException(GENERIC);
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      await this.store.recordFailure(user.id);
      throw new UnauthorizedException(GENERIC);
    }
    await this.store.recordSuccess(user.id);
    return { accessToken: this.tokens.signAccess(user), refreshToken: await this.tokens.issueRefresh(user) };
  }
}
