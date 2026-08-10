import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface RefreshRow {
  id: string; userId: string; familyId: string; revokedAt: Date | null; expiresAt: Date;
}

export interface RefreshStore {
  findByHash(hash: string): Promise<RefreshRow | null>;
  create(row: { userId: string; tokenHash: string; familyId: string; expiresAt: Date }): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  markUsed(id: string): Promise<void>;
  loadUser(userId: string): Promise<{ id: string; orgId: string; role: string; branchIds: string[] }>;
}

export interface AccessSigner { signAccess(user: { id: string; orgId: string; role: string; branchIds: string[] }): string }

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

@Injectable()
export class RefreshService {
  constructor(
    private readonly store: RefreshStore,
    private readonly signer: AccessSigner,
    private readonly ttlDays: number,
  ) {}

  async issue(user: { id: string }, familyId: string = randomUUID()): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await this.store.create({
      userId: user.id,
      tokenHash: sha256(raw),
      familyId,
      expiresAt: new Date(Date.now() + this.ttlDays * 86_400_000),
    });
    return raw;
  }

  /**
   * Replay of an already-revoked token means the token was stolen: the thief and
   * the owner now both hold tokens in the same family. Revoking the family — in
   * its own committed write, BEFORE the 401 — logs both out rather than letting
   * the thief keep rotating.
   */
  async rotate(raw: string): Promise<{ accessToken: string; refreshToken: string }> {
    const row = await this.store.findByHash(sha256(raw));
    if (!row) throw new UnauthorizedException();

    if (row.revokedAt) {
      await this.store.revokeFamily(row.familyId);
      throw new UnauthorizedException();
    }
    if (row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();

    await this.store.markUsed(row.id);
    const user = await this.store.loadUser(row.userId);
    return {
      accessToken: this.signer.signAccess(user),
      refreshToken: await this.issue(user, row.familyId),
    };
  }
}
