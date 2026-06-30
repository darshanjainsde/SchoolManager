import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { getPlatformPrisma, Prisma, UserRole } from '@skoolos/db';
import { redisConnectionFromUrl } from '../../../common/queue/redis-connection';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from '../../auth';
import { OnboardSchoolDto } from './onboarding.dto';

export interface ProvisionedSchool {
  schoolId: string;
  slug: string;
  adminUserId: string;
  adminEmail: string;
  inviteToken: string;
  customDomainId?: string;
  jobIds: { provisioning: string; domainVerification?: string };
}

/**
 * Orchestrates the "fill one form → provisioned tenant" flow:
 *
 *   1. Create School row (+ branding + address + locale).
 *   2. Create a default AcademicYear (if not supplied).
 *   3. Create the school-admin User with a one-time invite token (sent by the
 *      provisioning worker via SMTP/MailHog).
 *   4. (Optional) record a CustomDomain in PENDING + enqueue verification.
 *   5. Enqueue the heavy work — bulk-import users, send invite email, apply
 *      branding warm-up — to BullMQ so the request returns fast.
 *
 * Everything DB-side happens via the platform Prisma (BYPASSRLS), since
 * tenant context is being constructed *here* and isn't yet on the request.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly env = loadEnv();
  private readonly provisioningQueue: Queue;
  private readonly domainQueue: Queue;

  constructor(private readonly passwords: PasswordService) {
    const connection = redisConnectionFromUrl(this.env.REDIS_URL);
    this.provisioningQueue = new Queue('school-provisioning', { connection });
    this.domainQueue = new Queue('domain-verification', { connection });
  }

  async onboard(dto: OnboardSchoolDto): Promise<ProvisionedSchool> {
    const prisma = getPlatformPrisma();

    // Pre-flight uniqueness checks for nicer error messages.
    const existingSlug = await prisma.school.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) throw new ConflictException(`slug "${dto.slug}" is taken`);
    if (dto.customDomain) {
      const existingDomain = await prisma.customDomain.findUnique({
        where: { hostname: dto.customDomain.hostname.toLowerCase() },
      });
      if (existingDomain) throw new ConflictException(`domain already registered`);
    }

    // One-time invite token — emailed to the new admin so they set their password.
    // The placeholder hash makes the row valid but unusable until set.
    const inviteToken = randomBytes(24).toString('hex');
    const placeholderHash = await this.passwords.hash(randomBytes(32).toString('hex'));

    const out = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: dto.name,
          slug: dto.slug.toLowerCase(),
          logoUrl: dto.logoUrl,
          faviconUrl: dto.faviconUrl,
          brandColors: (dto.brandColors as unknown as Prisma.InputJsonValue) ?? undefined,
          aboutPage: dto.aboutPage,
          addressLine1: dto.address?.line1,
          addressLine2: dto.address?.line2,
          city: dto.address?.city,
          region: dto.address?.region,
          postalCode: dto.address?.postalCode,
          country: dto.address?.country,
          geoLat: dto.address?.lat,
          geoLng: dto.address?.lng,
          phone: dto.phone,
          email: dto.email,
          timezone: dto.timezone ?? 'UTC',
          locale: dto.locale ?? 'en-US',
          currency: dto.currency ?? 'USD',
          subscriptionPlan: dto.subscriptionPlan ?? 'TRIAL',
          subscriptionStatus: 'ACTIVE',
        },
      });

      const yr = dto.academicYear ?? defaultAcademicYear();
      await tx.academicYear.create({
        data: {
          schoolId: school.id,
          name: yr.name,
          startDate: new Date(yr.startDate),
          endDate: new Date(yr.endDate),
          isCurrent: true,
        },
      });

      const admin = await tx.user.create({
        data: {
          schoolId: school.id,
          email: dto.adminEmail.toLowerCase(),
          role: UserRole.SCHOOL_ADMIN,
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          passwordHash: placeholderHash,
          isActive: true,
        },
      });

      let customDomainId: string | undefined;
      if (dto.customDomain) {
        const cd = await tx.customDomain.create({
          data: {
            schoolId: school.id,
            hostname: dto.customDomain.hostname.toLowerCase(),
            type: dto.customDomain.type,
            status: 'PENDING',
            dnsTarget:
              dto.customDomain.type === 'SUBDOMAIN'
                ? this.env.INGRESS_CNAME_TARGET
                : this.env.INGRESS_A_RECORD,
            isPrimary: dto.customDomain.isPrimary ?? false,
          },
        });
        customDomainId = cd.id;
      }

      return { school, admin, customDomainId };
    });

    // Heavy work goes to BullMQ. Provisioning sends the invite email + bulk
    // imports; domain verification probes DNS + HTTP.
    const provisioningJob = await this.provisioningQueue.add(
      'provision-school',
      {
        schoolId: out.school.id,
        adminUserId: out.admin.id,
        adminEmail: out.admin.email,
        adminFirstName: out.admin.firstName,
        inviteToken,
        initialTeachers: dto.initialTeachers ?? [],
        initialStudents: dto.initialStudents ?? [],
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100 },
    );

    let domainJobId: string | undefined;
    if (out.customDomainId) {
      const j = await this.domainQueue.add(
        'verify-domain',
        { customDomainId: out.customDomainId },
        { attempts: 2, removeOnComplete: 100 },
      );
      domainJobId = j.id;
    }

    this.logger.log(`onboarded school ${out.school.slug} (${out.school.id})`);

    return {
      schoolId: out.school.id,
      slug: out.school.slug,
      adminUserId: out.admin.id,
      adminEmail: out.admin.email,
      inviteToken,
      customDomainId: out.customDomainId,
      jobIds: { provisioning: provisioningJob.id!, domainVerification: domainJobId },
    };
  }

  /** Test/admin helper: complete the invite by setting the admin's password. */
  async completeInvite(userId: string, password: string): Promise<void> {
    if (!password || password.length < 8) {
      throw new BadRequestException('password too short');
    }
    const hash = await this.passwords.hash(password);
    await getPlatformPrisma().user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    });
  }
}

function defaultAcademicYear(): { name: string; startDate: string; endDate: string } {
  const year = new Date().getFullYear();
  return {
    name: `${year}-${year + 1}`,
    startDate: `${year}-08-01`,
    endDate: `${year + 1}-06-30`,
  };
}
