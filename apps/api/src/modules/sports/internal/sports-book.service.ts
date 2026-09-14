import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { formatMark, groupLabel, rankMarks, resolveSport, type MarkScoring } from '@skoolos/types';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { SportsSettingsService } from './sports-settings.service';

export interface BookHolder { name: string; text: string; value: number; year: number }
export interface BookLine {
  /** `sportKey|groupKey|category` — what the website config pins. */
  key: string;
  sportKey: string; sportName: string; groupKey: string; groupLabel: string; category: string;
  unit: string; lowerIsBetter: boolean;
  /** The verified standing record, or null when the line has marks but no record yet. */
  record: (BookHolder & { setOn: string | null }) | null;
  /** Earlier holders, oldest first, each with the year it fell. */
  history: (BookHolder & { untilYear: number | null })[];
  /** All-time bests on the line: the record, past records and every ranked heat, one entry per person. Ties share a rank. */
  top: (BookHolder & { rank: number })[];
}
export interface LineIndexRow { key: string; label: string; groupKey: string; hasRecord: boolean; marks: number }

export interface BookOptions {
  /** Applied to every name in the book. Called with the person's full name. */
  formatName: (full: string) => string;
  /** Group keys to keep; empty = all. */
  groups: string[];
  /** Entries per line in `top`. */
  topN: number;
}

/**
 * The Book of Records as the website (and the builder tab) read it — the one
 * place the sports module hands its data outward. A line is sport × group ×
 * category. The record and its history come from the verified book; the
 * all-time bests add every mark from a ranked heat, so a child who ran a good
 * time in a heat is on the line even if she never held the record. Nothing
 * here is stored: it is computed on read and cached at the edge.
 */
@Injectable()
export class SportsBookService {
  constructor(private readonly settings: SportsSettingsService) {}

  /** Every line the school has, for the builder's pin list. Cheap: records and a mark count only. */
  lineIndex(schoolId: string): Promise<LineIndexRow[]> {
    return withTenant(schoolId, async (tx) => {
      const view = this.settings.view(await this.settings.ensure(tx, schoolId));
      const [records, events] = await Promise.all([
        tx.sportsRecord.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, status: 'STANDING' }, select: { sportKey: true, groupKey: true, category: true } }),
        tx.sportsEvent.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, kind: { in: ['MEASURED', 'JUDGED'] }, tournament: { published: true } }, select: { sportKey: true, sportName: true, groupKey: true, category: true } }),
      ]);
      const rows = new Map<string, LineIndexRow>();
      const add = (sportKey: string, sportName: string | undefined, groupKey: string, category: string, hasRecord: boolean) => {
        const key = `${sportKey}|${groupKey}|${category}`;
        const sport = resolveSport(sportKey, sportName);
        const cur = rows.get(key) ?? { key, label: `${sport?.name ?? sportName ?? sportKey} · ${groupLabel(view.grouping, view.bands, groupKey)} ${category}`, groupKey, hasRecord: false, marks: 0 };
        cur.hasRecord = cur.hasRecord || hasRecord;
        if (!hasRecord) cur.marks += 1;
        rows.set(key, cur);
      };
      for (const r of records) add(r.sportKey, undefined, r.groupKey, r.category, true);
      for (const e of events) add(e.sportKey, e.sportName, e.groupKey, e.category, false);
      return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
    });
  }

  book(schoolId: string, opts: BookOptions): Promise<BookLine[]> {
    return withTenant(schoolId, (tx) => this.bookIn(tx, schoolId, opts));
  }

  async bookIn(tx: TenantTx, schoolId: string, opts: BookOptions): Promise<BookLine[]> {
    const view = this.settings.view(await this.settings.ensure(tx, schoolId));
    const groupOk = (g: string) => opts.groups.length === 0 || opts.groups.includes(g);
    const [records, marks] = await Promise.all([
      tx.sportsRecord.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, status: { in: ['STANDING', 'BROKEN'] } }, orderBy: [{ sinceYear: 'asc' }, { createdAt: 'asc' }] }),
      tx.sportsMark.findMany({
        take: LIST_CEILING.ROSTER, where: { schoolId, mark: { not: null }, heat: { done: true } },
        select: { studentId: true, mark: true, heat: { select: { event: { select: { sportKey: true, sportName: true, groupKey: true, category: true, tournament: { select: { startsOn: true } } } } } } },
      }),
    ]);
    const studentIds = [...new Set([...marks.map((m) => m.studentId), ...records.map((r) => r.holderStudentId).filter((x): x is string => !!x)])];
    const students = studentIds.length
      ? await tx.student.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameOf = new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()]));

    type Cand = { who: string; name: string; value: number; year: number };
    const lines = new Map<string, { sportKey: string; sportName: string; groupKey: string; category: string; scoring: MarkScoring; cands: Map<string, Cand> }>();
    const lineFor = (sportKey: string, sportName: string, groupKey: string, category: string) => {
      const key = `${sportKey}|${groupKey}|${category}`;
      let l = lines.get(key);
      if (!l) {
        const sport = resolveSport(sportKey, sportName);
        if (!sport || sport.scoring.type !== 'MARK') return null;
        l = { sportKey, sportName: sport.name, groupKey, category, scoring: sport.scoring, cands: new Map() };
        lines.set(key, l);
      }
      return l;
    };
    const consider = (l: NonNullable<ReturnType<typeof lineFor>>, who: string, name: string, value: number, year: number) => {
      const cur = l.cands.get(who);
      const better = !cur || (l.scoring.lowerIsBetter ? value < cur.value : value > cur.value);
      if (better) l.cands.set(who, { who, name, value, year });
    };
    for (const m of marks) {
      const ev = m.heat.event;
      if (!groupOk(ev.groupKey) || m.mark == null) continue;
      const l = lineFor(ev.sportKey, ev.sportName, ev.groupKey, ev.category);
      if (!l) continue;
      consider(l, m.studentId, nameOf.get(m.studentId) ?? 'Former student', m.mark, ev.tournament.startsOn.getUTCFullYear());
    }
    for (const r of records) {
      if (!groupOk(r.groupKey)) continue;
      const l = lineFor(r.sportKey, r.sportKey, r.groupKey, r.category);
      if (!l) continue;
      const name = r.holderStudentId ? nameOf.get(r.holderStudentId) ?? r.holderName : r.holderName;
      consider(l, r.holderStudentId ?? `n:${r.holderName.trim().toLowerCase()}`, name, r.value, r.sinceYear);
    }

    const out: BookLine[] = [];
    for (const [key, l] of lines) {
      const text = (v: number) => formatMark(l.scoring, v);
      const mine = records.filter((r) => `${r.sportKey}|${r.groupKey}|${r.category}` === key);
      const standing = mine.find((r) => r.status === 'STANDING') ?? null;
      const holderName = (r: { holderStudentId: string | null; holderName: string }) => opts.formatName(r.holderStudentId ? nameOf.get(r.holderStudentId) ?? r.holderName : r.holderName);
      const ranked = rankMarks([...l.cands.values()].map((c) => ({ item: c, mark: c.value })), l.scoring.lowerIsBetter);
      const top: BookLine['top'] = [];
      for (const r of ranked) {
        if (r.rank == null || r.rank > opts.topN) break;
        top.push({ rank: r.rank, name: opts.formatName(r.item.name), text: text(r.item.value), value: r.item.value, year: r.item.year });
      }
      out.push({
        key, sportKey: l.sportKey, sportName: l.sportName, groupKey: l.groupKey, groupLabel: groupLabel(view.grouping, view.bands, l.groupKey), category: l.category,
        unit: l.scoring.unit, lowerIsBetter: l.scoring.lowerIsBetter,
        record: standing ? { name: holderName(standing), text: text(standing.value), value: standing.value, year: standing.sinceYear, setOn: standing.setOn ? standing.setOn.toISOString().slice(0, 10) : null } : null,
        history: mine.filter((r) => r.status === 'BROKEN').map((r) => ({ name: holderName(r), text: text(r.value), value: r.value, year: r.sinceYear, untilYear: r.untilYear })),
        top,
      });
    }
    return out.sort((a, b) => a.sportName.localeCompare(b.sportName) || a.groupLabel.localeCompare(b.groupLabel) || a.category.localeCompare(b.category));
  }
}
