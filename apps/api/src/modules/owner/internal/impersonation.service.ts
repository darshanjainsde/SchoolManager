import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@skoolos/config';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Owner → school-admin login handoff. Mints a single-use 15-minute token and
 * returns the school-host URL that exchanges it (see POST /auth/impersonate).
 * The link host comes from the school's own DB record, mirroring the
 * password-reset link rules — never from request headers.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private readonly env = loadEnv();

  async mint(schoolId: string, mintedByUserId?: string): Promise<{ url: string; expiresInSeconds: number }> {
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: {
        slug: true,
        domains: { where: { isPrimary: true, status: 'LIVE' }, select: { hostname: true }, take: 1 },
      },
    });
    if (!school) throw new NotFoundException(`School ${schoolId} not found`);

    const admin = await db.user.findFirst({
      where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    });
    if (!admin) throw new ConflictException('School has no active admin account to impersonate');

    const token = randomBytes(24).toString('base64url');
    await db.impersonationToken.create({
      data: {
        userId: admin.id, schoolId, tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        // So the audit trail can say WHO acted inside the school, not just
        // that somebody did.
        mintedByUserId: mintedByUserId ?? null,
      },
    });

    const host = school.domains[0]?.hostname ?? `${school.slug}.${this.env.PLATFORM_HOST}`;
    const scheme = host.endsWith('.localhost') ? 'http' : 'https';
    const port = host.endsWith('.localhost') ? ':3000' : '';
    this.logger.warn(`Owner minted impersonation for ${admin.email} (school ${school.slug})`);
    return { url: `${scheme}://${host}${port}/login?imp=${token}`, expiresInSeconds: TOKEN_TTL_MS / 1000 };
  }
}
