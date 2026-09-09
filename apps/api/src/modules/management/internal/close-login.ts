import { getPlatformPrisma } from '@skoolos/db';

/**
 * Login shutdown is cross-cutting auth state, so it runs on the PLATFORM
 * client, after the tenant transaction commits — the same revoke-all pattern
 * TeachersService.release() and a password reset already use.
 *
 * A child's login ends with their time at the school (every leaving status,
 * alumni included — the Homecoming wing is the adult door). A teacher's ends
 * when they are removed from this school, which is what frees them to be
 * onboarded elsewhere.
 */
export async function closeLogin(userId: string): Promise<void> {
  const platform = getPlatformPrisma();
  await platform.$transaction([
    platform.user.update({ where: { id: userId }, data: { isActive: false } }),
    platform.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

/** Re-admit / reactivate: the account opens again; sessions were already revoked. */
export async function reopenLogin(userId: string): Promise<void> {
  await getPlatformPrisma().user.update({ where: { id: userId }, data: { isActive: true } });
}
