import type { TenantTx } from '@skoolos/db';

/**
 * Login shutdown and reopening, INSIDE the caller's tenant transaction.
 *
 * A first cut ran these on the platform client after the tenant commit — the
 * revoke-all pattern a password reset uses. Review found the seam: if the
 * second step failed, a child could be ACTIVE on the roll with a closed login
 * (or LEFT with an open one), and the retry hit NOT_ACTIVE / ALREADY_ACTIVE
 * without ever touching the login. `User` and `RefreshToken` both carry
 * `schoolId` and are already written through `tx` by createLogin and
 * refresh(), so the row and its login now change together or not at all.
 *
 * A child's login ends with their time at the school (every leaving status,
 * alumni included — the Homecoming wing is the adult door). A teacher's ends
 * when they are removed from this school, which is what frees them to be
 * onboarded elsewhere.
 */
export async function closeLoginIn(tx: TenantTx, schoolId: string, userId: string): Promise<void> {
  await tx.user.updateMany({ where: { id: userId, schoolId }, data: { isActive: false } });
  await tx.refreshToken.updateMany({
    where: { schoolId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Re-admit / reactivate: the account opens again; old sessions stay revoked. */
export async function reopenLoginIn(tx: TenantTx, schoolId: string, userId: string): Promise<void> {
  await tx.user.updateMany({ where: { id: userId, schoolId }, data: { isActive: true } });
}
