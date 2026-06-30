import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { getPlatformPrisma, Prisma, withTenant } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';
import { AuditService } from '../../../common/audit/audit.service';

export class UpdateBrandingDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() logoUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() faviconUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() aboutPage?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  brandPrimary?: string;
}

@ApiTags('platform-schools')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/schools')
export class SchoolsMgmtController {
  private readonly env = loadEnv();

  constructor(
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  @Patch(':id/branding')
  async updateBranding(
    @Param('id') id: string,
    @Body() dto: UpdateBrandingDto,
    @CurrentUser() owner: PlatformJwtPayload,
  ) {
    const school = await getPlatformPrisma().school.findUnique({ where: { id } });
    if (!school) throw new NotFoundException();

    const updated = await getPlatformPrisma().school.update({
      where: { id },
      data: {
        logoUrl: dto.logoUrl ?? school.logoUrl,
        faviconUrl: dto.faviconUrl ?? school.faviconUrl,
        aboutPage: dto.aboutPage ?? school.aboutPage,
        brandColors:
          dto.brandPrimary !== undefined
            ? ({ ...(school.brandColors as object | null ?? {}), primary: dto.brandPrimary } as Prisma.InputJsonValue)
            : undefined,
      },
    });
    await this.audit.record({
      scope: 'PLATFORM',
      schoolId: id,
      actorId: owner.sub,
      actorType: 'platform',
      action: `PATCH /platform/schools/${id}/branding`,
      targetType: 'School',
      targetId: id,
    });
    return updated;
  }

  /** Soft-suspend: blocks tenant resolution + login. Reversible. */
  @Post(':id/suspend')
  async suspend(@Param('id') id: string, @CurrentUser() owner: PlatformJwtPayload) {
    const school = await getPlatformPrisma().school.update({
      where: { id },
      data: { suspendedAt: new Date(), subscriptionStatus: 'SUSPENDED' },
    });
    await this.audit.record({
      scope: 'PLATFORM',
      schoolId: id,
      actorId: owner.sub,
      actorType: 'platform',
      action: `POST /platform/schools/${id}/suspend`,
      targetType: 'School',
      targetId: id,
    });
    return school;
  }

  @Post(':id/unsuspend')
  async unsuspend(@Param('id') id: string, @CurrentUser() owner: PlatformJwtPayload) {
    const school = await getPlatformPrisma().school.update({
      where: { id },
      data: { suspendedAt: null, subscriptionStatus: 'ACTIVE' },
    });
    await this.audit.record({
      scope: 'PLATFORM',
      schoolId: id,
      actorId: owner.sub,
      actorType: 'platform',
      action: `POST /platform/schools/${id}/unsuspend`,
      targetType: 'School',
      targetId: id,
    });
    return school;
  }

  /**
   * Mint a SHORT-LIVED school-audience JWT impersonating the school's admin.
   * Always audited. Owner must hold a platform token to begin with, so this
   * is a privileged escalation we want a clear trail for.
   */
  @Post(':id/impersonate')
  async impersonate(@Param('id') id: string, @CurrentUser() owner: PlatformJwtPayload) {
    const admin = await getPlatformPrisma().user.findFirst({
      where: { schoolId: id, role: 'SCHOOL_ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw new NotFoundException('School has no active admin');

    const ttl = 15 * 60; // 15 minutes — tight by design
    const accessToken = this.jwt.sign(
      {
        sub: admin.id,
        aud: 'school',
        schoolId: admin.schoolId,
        role: admin.role,
        jti: randomUUID(),
        impersonatedBy: owner.sub,
      },
      { secret: this.env.JWT_SCHOOL_ACCESS_SECRET, expiresIn: ttl },
    );

    await this.audit.record({
      scope: 'PLATFORM',
      schoolId: id,
      actorId: owner.sub,
      actorType: 'platform',
      action: `POST /platform/schools/${id}/impersonate`,
      targetType: 'User',
      targetId: admin.id,
      metadata: { impersonatedUserEmail: admin.email },
    });
    return { accessToken, expiresIn: ttl, asUser: admin.id };
  }

  /** Per-tenant usage view — rows + a stub for storage attribution. */
  @Get(':id/usage')
  async usage(@Param('id') id: string) {
    const school = await getPlatformPrisma().school.findUnique({ where: { id } });
    if (!school) throw new NotFoundException();

    const usage = await withTenant(id, async (tx) => {
      const [users, students, teachers, customDomains, academicYears] = await Promise.all([
        tx.user.count(),
        tx.user.count({ where: { role: 'STUDENT' } }),
        tx.user.count({ where: { role: 'TEACHER' } }),
        tx.customDomain.count(),
        tx.academicYear.count(),
      ]);
      return { users, students, teachers, customDomains, academicYears };
    });

    return {
      schoolId: id,
      slug: school.slug,
      ...usage,
      // Full storage accounting lands Phase 7.
      storageBytes: null as null | number,
    };
  }

  /** Hard-delete is intentionally not exposed — suspension is the only reversal. */
  @Delete(':id')
  async deletionNotPermitted() {
    throw new ForbiddenException('Use /suspend; hard delete is not supported');
  }
}
