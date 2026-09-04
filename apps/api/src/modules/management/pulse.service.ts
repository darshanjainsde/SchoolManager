import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { DashboardPulse } from '@skoolos/types';
import { FeatureResolverService } from '../features';
import { FeeQueryService } from '../fees';
import { istToday } from './bell.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The dashboard's living tiles: attendance with a 14-school-day line, the
 * fee position, the enquiry trend, the roll. Composed live, IST calendar
 * (the compute-don't-store rule — a tile can never disagree with the screen
 * it links to, because it is the same read).
 */
@Injectable()
export class PulseService {
  constructor(
    private readonly features: FeatureResolverService,
    private readonly feeQuery: FeeQueryService,
  ) {}

  async pulse(schoolId: string, now = new Date()): Promise<DashboardPulse> {
    const hasFees = (await this.features.getFeatures(schoolId)).has('FEES');
    const { dateOnly } = istToday(now);
    const todayYmd = dateOnly.toISOString().slice(0, 10);
    // 30 calendar days back is always ≥14 school days ahead of holidays.
    const lookback = new Date(dateOnly.getTime() - 30 * DAY_MS);
    const fourteenAgo = new Date(dateOnly.getTime() - 13 * DAY_MS);

    const base = await withTenant(schoolId, async (tx) => {
      const [attRows, enquiries, students, teachers, classes, uncontacted] = await Promise.all([
        tx.attendance.groupBy({
          by: ['date', 'status'],
          where: { date: { gte: lookback, lte: dateOnly } },
          _count: { _all: true },
        }),
        tx.enquiry.findMany({
          where: { createdAt: { gte: new Date(fourteenAgo.getTime() - 5.5 * 60 * 60 * 1000) } },
          select: { createdAt: true },
          take: 2000,
        }),
        tx.student.count({ where: { isActive: true } }),
        tx.teacher.count({ where: { isActive: true } }),
        tx.classSection.count({ where: {} }),
        tx.enquiry.count({ where: { status: 'NEW' } }),
      ]);

      // ── attendance: one % per marked day, last 14 of them ────────────────
      const byDay = new Map<string, { present: number; total: number }>();
      for (const r of attRows) {
        const key = r.date.toISOString().slice(0, 10);
        const agg = byDay.get(key) ?? { present: 0, total: 0 };
        const n = r._count._all;
        agg.total += n;
        if (r.status === 'PRESENT' || r.status === 'LATE') agg.present += n;
        byDay.set(key, agg);
      }
      const series = [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(-14)
        .map(([date, v]) => ({ date, pct: Math.round((v.present / v.total) * 100) }));
      const today = byDay.get(todayYmd);

      // ── enquiries: two weeks of daily counts, split 7/7 ──────────────────
      const perDay = new Map<string, number>();
      for (const e of enquiries) {
        // Bucket by IST calendar day.
        const key = new Date(e.createdAt.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
      }
      let last7 = 0;
      let prev7 = 0;
      const enqSeries: { date: string; count: number }[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(dateOnly.getTime() - i * DAY_MS);
        const key = d.toISOString().slice(0, 10);
        const count = perDay.get(key) ?? 0;
        if (i <= 6) {
          last7 += count;
          enqSeries.push({ date: key, count });
        } else {
          prev7 += count;
        }
      }

      return {
        attendance: {
          todayPct: today && today.total > 0 ? Math.round((today.present / today.total) * 100) : null,
          present: today?.present ?? 0,
          marked: today?.total ?? 0,
          series,
        },
        enquiries: { last7, prev7, uncontacted, series: enqSeries },
        roll: { students, teachers, classes },
      };
    });

    // ── fees: the summary the fees home already trusts, plus who owes ──────
    let fees: DashboardPulse['fees'] = null;
    if (hasFees) {
      const summary = await this.feeQuery.collectionSummary(schoolId);
      const owingFamilies = await withTenant(schoolId, async (tx) => {
        const grouped = await tx.feeLedgerEntry.groupBy({
          by: ['studentId', 'kind'],
          where: {},
          _sum: { amountMinor: true },
        });
        const net = new Map<string, number>();
        for (const g of grouped) {
          const amt = g._sum.amountMinor ?? 0;
          net.set(g.studentId, (net.get(g.studentId) ?? 0) + (g.kind === 'DEBIT' ? amt : -amt));
        }
        let owing = 0;
        for (const v of net.values()) if (v > 0) owing++;
        return owing;
      });
      fees = {
        billedMinor: summary.billedMinor,
        collectedMinor: summary.collectedMinor,
        outstandingMinor: summary.outstandingMinor,
        owingFamilies,
      };
    }

    return { ...base, fees };
  }
}
