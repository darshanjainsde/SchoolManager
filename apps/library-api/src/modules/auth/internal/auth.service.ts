import { Injectable, UnauthorizedException } from '@nestjs/common';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenIssuer,
  ) {}

  async login(orgId: string, identifier: string, password: string) {
    const user = await this.store.findByIdentifier(orgId, identifier);
    if (!user || !user.active) throw new UnauthorizedException(GENERIC);
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
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
