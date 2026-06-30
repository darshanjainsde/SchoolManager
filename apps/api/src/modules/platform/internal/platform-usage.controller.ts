import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getPlatformPrisma } from '@skoolos/db';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';

interface UsageRow {
  schoolId: string;
  slug: string;
  name: string;
  userCount: bigint;
  studentCount: bigint;
  teacherCount: bigint;
  classCount: bigint;
  enrollmentCount: bigint;
  attendanceCount: bigint;
  assignmentCount: bigint;
  invoiceCount: bigint;
  paymentTotal: string;
  auditCount: bigint;
}

/**
 * Phase 7 — per-tenant usage view. Reads from the `tenant_usage` SQL view
 * created in migration 20260619120000_phase7_usage_view. The platform role
 * has BYPASSRLS so the SELECT works across tenants without setting context.
 */
@ApiTags('platform-usage')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/usage')
export class PlatformUsageController {
  @Get()
  async list(): Promise<unknown> {
    const rows = await getPlatformPrisma().$queryRawUnsafe<UsageRow[]>(
      'SELECT * FROM tenant_usage ORDER BY "name"',
    );
    // BigInts can't go straight to JSON.
    return rows.map((r) => ({
      schoolId: r.schoolId,
      slug: r.slug,
      name: r.name,
      userCount: Number(r.userCount),
      studentCount: Number(r.studentCount),
      teacherCount: Number(r.teacherCount),
      classCount: Number(r.classCount),
      enrollmentCount: Number(r.enrollmentCount),
      attendanceCount: Number(r.attendanceCount),
      assignmentCount: Number(r.assignmentCount),
      invoiceCount: Number(r.invoiceCount),
      paymentTotal: Number(r.paymentTotal),
      auditCount: Number(r.auditCount),
    }));
  }
}
