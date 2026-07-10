import { Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';

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
}

export interface OverviewResponse {
  totals: {
    schools: number;
    live: number;
    storageBytes: number;
    enquiriesThisMonth: number;
    newLeads: number;
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
  /**
   * One dashboard payload: a groupBy per metric (4 queries total, regardless
   * of school count) joined in memory. Owner is cross-tenant by design, so
   * everything runs on the platform client.
   */
  async overview(): Promise<OverviewResponse> {
    const db = getPlatformPrisma();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [schools, storage, enquiries, newEnquiries, events, enquiriesThisMonth, newLeads] = await Promise.all([
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
    ]);

    const byId = <T extends { schoolId: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.schoolId, r]));
    const storageMap = byId(storage);
    const enqMap = byId(enquiries);
    const newEnqMap = byId(newEnquiries);
    const eventMap = byId(events);

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
    }));

    return {
      totals: {
        schools: schools.length,
        live: schools.filter((s) => s.status === 'LIVE').length,
        storageBytes: rows.reduce((sum, r) => sum + r.storageBytes, 0),
        enquiriesThisMonth,
        newLeads,
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
