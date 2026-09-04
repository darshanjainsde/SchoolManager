import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../../../common/redis/redis.client';

export interface SchoolMetrics {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  storageBytes: number;
  enquiries: number;
  newEnquiries: number;
  events: number;
  students: number;
  images: number;
}

export interface OverviewResponse {
  totals: {
    schools: number;
    live: number;
    storageBytes: number;
    enquiriesThisMonth: number;
    newLeads: number;
    students: number;
    images: number;
  };
  schools: SchoolMetrics[];
}

/** Escapes one CSV field per RFC 4180 (quote when it contains , " or newline). */
export function csvField(v: string | null | undefined): string {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class OwnerOverviewService {
  private readonly env = loadEnv();
  // These metrics are cross-tenant full-table aggregations (groupBy over every
  // school's students/images/enquiries). They do not need to be real-time for
  // the owner console, so cache the whole payload briefly — this turns a
  // multi-million-row scan on each view into one cheap Redis read.
  private static readonly CACHE_KEY = 'owner:overview';
  private static readonly TTL = 120; // seconds

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: SharedRedis = sharedRedis()) {}

  async overview(): Promise<OverviewResponse> {
    try {
      if (!(await ensureConnected(this.redis))) throw new Error('redis unavailable');
      const cached = await this.redis!.get(OwnerOverviewService.CACHE_KEY);
      if (cached) return JSON.parse(cached) as OverviewResponse;
    } catch {
      /* cache miss / Redis down → fall through to a live query */
    }

    const fresh = await this.computeOverview();

    try {
      await this.redis?.set(
        OwnerOverviewService.CACHE_KEY,
        JSON.stringify(fresh),
        'EX',
        OwnerOverviewService.TTL,
      );
    } catch {
      /* best-effort */
    }
    return fresh;
  }

  /**
   * Drops the cached payload so the next view recomputes.
   *
   * Without this the dashboard was simply wrong for up to two minutes after
   * any change: add a school and it is missing, publish one and the LIVE count
   * is stale, attach a domain and the column stays empty. The operator's
   * reasonable conclusion is that the action failed, so they do it again —
   * which is how you get two schools with the same name. A cache with no
   * invalidation hook is a correctness bug, not a performance trade-off.
   *
   * Best-effort by design: if Redis is unreachable the read path already falls
   * through to a live query, so a failed delete costs freshness, never a write.
   */
  async invalidate(): Promise<void> {
    try {
      if (!(await ensureConnected(this.redis))) return;
      await this.redis!.del(OwnerOverviewService.CACHE_KEY);
    } catch {
      /* the TTL is the backstop */
    }
  }

  private async computeOverview(): Promise<OverviewResponse> {
    const db = getPlatformPrisma();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [schools, storage, enquiries, newEnquiries, events, enquiriesThisMonth, newLeads, students, images] =
      await Promise.all([
        db.school.findMany({
          orderBy: { name: 'asc' },
          include: { domains: { where: { isPrimary: true }, take: 1 } },
        }),
        db.mediaAsset.groupBy({ by: ['schoolId'], _sum: { byteSize: true } }),
        db.enquiry.groupBy({ by: ['schoolId'], _count: true }),
        db.enquiry.groupBy({ by: ['schoolId'], _count: true, where: { status: 'NEW' } }),
        db.event.groupBy({ by: ['schoolId'], _count: true }),
        db.enquiry.count({ where: { createdAt: { gte: monthStart } } }),
        db.marketingLead.count({ where: { status: 'NEW' } }),
        db.student.groupBy({ by: ['schoolId'], _count: true }),
        db.mediaAsset.groupBy({ by: ['schoolId'], _count: true }),
      ]);

    const byId = <T extends { schoolId: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.schoolId, r]));
    const storageMap = byId(storage);
    const enqMap = byId(enquiries);
    const newEnqMap = byId(newEnquiries);
    const eventMap = byId(events);
    const studentMap = byId(students);
    const imageMap = byId(images);

    const rows: SchoolMetrics[] = schools.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      tier: s.tier as 'BASIC' | 'STANDARD' | 'PRO',
      status: s.status,
      primaryDomain: s.domains[0]?.hostname ?? null,
      storageBytes: storageMap.get(s.id)?._sum.byteSize ?? 0,
      enquiries: enqMap.get(s.id)?._count ?? 0,
      newEnquiries: newEnqMap.get(s.id)?._count ?? 0,
      events: eventMap.get(s.id)?._count ?? 0,
      students: studentMap.get(s.id)?._count ?? 0,
      images: imageMap.get(s.id)?._count ?? 0,
    }));

    return {
      totals: {
        schools: schools.length,
        live: schools.filter((s) => s.status === 'LIVE').length,
        storageBytes: rows.reduce((sum, r) => sum + r.storageBytes, 0),
        enquiriesThisMonth,
        newLeads,
        students: rows.reduce((sum, r) => sum + r.students, 0),
        images: rows.reduce((sum, r) => sum + r.images, 0),
      },
      schools: rows,
    };
  }

  /** All of one school's enquiries as a CSV attachment body. */
  async enquiriesCsv(schoolId: string): Promise<{ filename: string; body: string }> {
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { slug: true } });
    if (!school) throw new NotFoundException(`School ${schoolId} not found`);

    const enquiries = await db.enquiry.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
    });
    const header = 'createdAt,parentName,phone,email,gradeInterest,message,status';
    const lines = enquiries.map((e) =>
      [
        e.createdAt.toISOString(),
        csvField(e.parentName),
        csvField(e.phone),
        csvField(e.email),
        csvField(e.gradeInterest),
        csvField(e.message),
        e.status,
      ].join(','),
    );
    return { filename: `${school.slug}-enquiries.csv`, body: [header, ...lines].join('\r\n') + '\r\n' };
  }
}
