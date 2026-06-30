import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsString, Matches } from 'class-validator';
import { Queue } from 'bullmq';
import nodemailer from 'nodemailer';
import { randomBytes } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { redisConnectionFromUrl } from '../../../common/queue/redis-connection';

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const RESEND_THROTTLE_MS = 24 * 60 * 60 * 1000;

export class PreviewDnsDto {
  @ApiProperty()
  @IsString()
  @Matches(/^([a-z0-9-]+\.)+[a-z]{2,}$/i)
  hostname!: string;

  @ApiProperty({ enum: ['APEX', 'SUBDOMAIN'] })
  @IsEnum(['APEX', 'SUBDOMAIN'])
  type!: 'APEX' | 'SUBDOMAIN';
}

/**
 * Phase-2 finish-line endpoints. Read-only helpers for the wizard (slug check +
 * DNS preview) and a write endpoint to resend the admin invite. Owner portal
 * only — the existing PlatformHostGuard + PlatformJwtGuard chain is reused so
 * tenant hosts and school users cannot reach any of these.
 */
@ApiTags('platform-helpers')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform')
export class PlatformHelpersController {
  private readonly logger = new Logger(PlatformHelpersController.name);
  private readonly env = loadEnv();
  private readonly provisioningQueue: Queue;

  constructor() {
    this.provisioningQueue = new Queue('school-provisioning', {
      connection: redisConnectionFromUrl(this.env.REDIS_URL),
    });
  }

  /**
   * Live slug availability check for the wizard's Step 1. Returns a suggestion
   * if the requested slug is taken (`-2`, `-3` … up to a small cap).
   */
  @Get('schools/slug-availability')
  async slugAvailability(@Query('slug') slug?: string) {
    if (!slug || !SLUG_RE.test(slug)) {
      throw new BadRequestException('slug must be 2-32 chars, lowercase letters/digits/dashes');
    }
    const lower = slug.toLowerCase();
    const taken = await getPlatformPrisma().school.findUnique({ where: { slug: lower } });
    if (!taken) return { available: true };

    // Cheap suggester: try lower-2, lower-3 … 10. Bail with `null` if all taken.
    for (let i = 2; i <= 10; i++) {
      const candidate = `${lower}-${i}`;
      const found = await getPlatformPrisma().school.findUnique({ where: { slug: candidate } });
      if (!found) return { available: false, suggestion: candidate };
    }
    return { available: false, suggestion: null };
  }

  /**
   * Pure-function preview of the DNS records a school would need to paste.
   * Mirrors `DomainsController.dnsInstructionsFor` so the wizard can display
   * the records *before* the customDomain row exists.
   */
  @Post('schools/preview-dns')
  @HttpCode(200)
  previewDns(@Body() dto: PreviewDnsDto) {
    const hostname = dto.hostname.toLowerCase();
    if (dto.type === 'SUBDOMAIN') {
      const parts = hostname.split('.');
      const host = parts.length > 2 ? parts[0] : '@';
      return {
        hostname,
        type: dto.type,
        records: [
          {
            kind: 'CNAME',
            name: host,
            value: this.env.INGRESS_CNAME_TARGET,
            ttl: 300,
          },
        ],
      };
    }
    return {
      hostname,
      type: dto.type,
      records: [
        {
          kind: 'A',
          name: '@',
          value: this.env.INGRESS_A_RECORD,
          ttl: 300,
          note: 'Or an ALIAS / CNAME-flattening record if your DNS provider supports it.',
        },
      ],
    };
  }

  /**
   * Re-emit the admin invite email. Idempotent within 24h: looking at the
   * audit log for a matching action; if one is recent, return the same
   * shape but with `resent: false` and no second email goes out.
   */
  @Post('schools/:id/invite/resend')
  async resendInvite(@Param('id') id: string) {
    const school = await getPlatformPrisma().school.findUnique({ where: { id } });
    if (!school) throw new NotFoundException();

    const admin = await getPlatformPrisma().user.findFirst({
      where: { schoolId: id, role: 'SCHOOL_ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw new NotFoundException('School has no active admin');

    const since = new Date(Date.now() - RESEND_THROTTLE_MS);
    const recent = await getPlatformPrisma().auditLog.findFirst({
      where: {
        schoolId: id,
        action: { contains: 'invite/resend' },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      return { resent: false, throttled: true, retryAfterAt: new Date(recent.createdAt.getTime() + RESEND_THROTTLE_MS) };
    }

    const inviteToken = randomBytes(24).toString('hex');
    await this.provisioningQueue.add(
      'provision-school',
      {
        schoolId: id,
        adminUserId: admin.id,
        adminEmail: admin.email,
        adminFirstName: admin.firstName,
        inviteToken,
        initialTeachers: [],
        initialStudents: [],
        resendOnly: true,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100 },
    );

    await getPlatformPrisma().auditLog.create({
      data: {
        scope: 'PLATFORM',
        schoolId: id,
        actorType: 'platform',
        action: `POST /platform/schools/${id}/invite/resend`,
        targetType: 'User',
        targetId: admin.id,
      },
    });

    return { resent: true, throttled: false, adminUserId: admin.id, adminEmail: admin.email };
  }
}

/**
 * Lightweight dev/test seam to drain emails without standing up MailHog. Not
 * mounted in production; the controller below is exported but only registered
 * when NODE_ENV==='test'. Kept here so tests can assert the resend pathway.
 */
export function testSmtpFromEnv(): nodemailer.Transporter {
  const env = loadEnv();
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
  });
}
