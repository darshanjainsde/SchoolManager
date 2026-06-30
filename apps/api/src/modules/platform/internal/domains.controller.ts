import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { Queue } from 'bullmq';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { redisConnectionFromUrl } from '../../../common/queue/redis-connection';

export class CreateDomainDto {
  @ApiProperty()
  @IsString()
  @Matches(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, { message: 'hostname must be a valid FQDN' })
  hostname!: string;

  @ApiProperty({ enum: ['APEX', 'SUBDOMAIN'] })
  @IsEnum(['APEX', 'SUBDOMAIN'])
  type!: 'APEX' | 'SUBDOMAIN';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

@ApiTags('platform-domains')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/schools/:schoolId/domains')
export class DomainsController {
  private readonly env = loadEnv();
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue('domain-verification', {
      connection: redisConnectionFromUrl(this.env.REDIS_URL),
    });
  }

  @Get()
  async list(@Param('schoolId') schoolId: string) {
    const rows = await getPlatformPrisma().customDomain.findMany({
      where: { schoolId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((d) => ({ ...d, dnsInstructions: this.dnsInstructionsFor(d.hostname, d.type) }));
  }

  @Post()
  async create(@Param('schoolId') schoolId: string, @Body() dto: CreateDomainDto) {
    const hostname = dto.hostname.toLowerCase();
    const conflict = await getPlatformPrisma().customDomain.findUnique({ where: { hostname } });
    if (conflict) throw new BadRequestException('hostname already registered');

    const created = await getPlatformPrisma().customDomain.create({
      data: {
        schoolId,
        hostname,
        type: dto.type,
        status: 'PENDING',
        isPrimary: dto.isPrimary ?? false,
        dnsTarget:
          dto.type === 'SUBDOMAIN' ? this.env.INGRESS_CNAME_TARGET : this.env.INGRESS_A_RECORD,
      },
    });

    await this.queue.add('verify-domain', { customDomainId: created.id });
    return { ...created, dnsInstructions: this.dnsInstructionsFor(created.hostname, created.type) };
  }

  /** Trigger an on-demand verification job. */
  @Post(':id/verify')
  async verify(@Param('id') id: string) {
    const cd = await getPlatformPrisma().customDomain.findUnique({ where: { id } });
    if (!cd) throw new NotFoundException();
    await getPlatformPrisma().customDomain.update({
      where: { id },
      data: { status: 'VERIFYING', lastError: null },
    });
    const job = await this.queue.add('verify-domain', { customDomainId: id });
    return { jobId: job.id, status: 'VERIFYING' };
  }

  @Post(':id/primary')
  async setPrimary(@Param('schoolId') schoolId: string, @Param('id') id: string) {
    const cd = await getPlatformPrisma().customDomain.findUnique({ where: { id } });
    if (!cd || cd.schoolId !== schoolId) throw new NotFoundException();
    await getPlatformPrisma().$transaction([
      getPlatformPrisma().customDomain.updateMany({
        where: { schoolId, isPrimary: true },
        data: { isPrimary: false },
      }),
      getPlatformPrisma().customDomain.update({
        where: { id },
        data: { isPrimary: true },
      }),
    ]);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('schoolId') schoolId: string, @Param('id') id: string) {
    const cd = await getPlatformPrisma().customDomain.findUnique({ where: { id } });
    if (!cd || cd.schoolId !== schoolId) throw new NotFoundException();
    await getPlatformPrisma().customDomain.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Exact records the user/owner needs to paste at the registrar. Values are
   * derived from env so prod and local are correctly differentiated.
   */
  private dnsInstructionsFor(
    hostname: string,
    type: 'APEX' | 'SUBDOMAIN',
  ): Array<{ kind: 'CNAME' | 'A' | 'ALIAS'; name: string; value: string; ttl: number; note?: string }> {
    if (type === 'SUBDOMAIN') {
      const parts = hostname.split('.');
      const host = parts.length > 2 ? parts[0] : '@';
      return [
        {
          kind: 'CNAME',
          name: host,
          value: this.env.INGRESS_CNAME_TARGET,
          ttl: 300,
        },
      ];
    }
    return [
      {
        kind: 'A',
        name: '@',
        value: this.env.INGRESS_A_RECORD,
        ttl: 300,
        note: 'Or an ALIAS / CNAME-flattening record at the apex if your DNS provider supports it.',
      },
    ];
  }
}
