import type { TenantTx } from '@skoolos/db';

/**
 * PUT ONE TEACHER IN ONE PERIOD, FOR A STRETCH OF TIME.
 *
 * A timetable period (class × weekday × period × year) is a run of VERSIONS,
 * each live over [effectiveFrom, effectiveTo) — effectiveTo null means "until
 * further notice". Reading a date returns the version live on it, which is
 * what keeps past weeks exactly as they were taught.
 *
 * A change is a splice of that run over a window [from, until):
 *   - `until` null  → "from now on": the change runs into every coming week;
 *   - `until` a day → "this week only": the version that was there before
 *     comes back on `until`, unprompted.
 * `from` is never before today — the service clamps it — so a version that
 * already lived is only ever SHORTENED (closed at `from`), never rewritten.
 * Versions that start inside the window have not happened yet; they are
 * moved past the window, reused for the new value, or removed.
 *
 * Pure planning here (every date case is unit-tested without a database);
 * `applySplice` performs the plan inside the caller's transaction.
 */
export interface SlotVersion {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  subjectId: string;
  teacherId: string;
}
export interface SlotValue {
  subjectId: string;
  teacherId: string;
}
export type SpliceOp =
  | { kind: 'close'; id: string; to: Date }
  | { kind: 'shift'; id: string; from: Date }
  | { kind: 'delete'; id: string }
  | { kind: 'reuse'; id: string; value: SlotValue; to: Date | null }
  /** `role`: the new value at `from`, or the earlier value restored after `until`. */
  | { kind: 'create'; role: 'value' | 'tail'; from: Date; to: Date | null; value: SlotValue };

const end = (v: SlotVersion) => (v.effectiveTo ? v.effectiveTo.getTime() : Infinity);
const same = (v: SlotVersion, x: SlotValue) => v.subjectId === x.subjectId && v.teacherId === x.teacherId;

/**
 * The writes that make [from, until) hold `value` (or nothing, for a removal)
 * and leave every moment outside the window exactly as it was.
 * Returns [] when nothing would change.
 */
export function planSplice(versions: SlotVersion[], from: Date, until: Date | null, value: SlotValue | null): SpliceOp[] {
  const f = from.getTime();
  const u = until ? until.getTime() : Infinity;
  const overlapping = versions
    .filter((v) => v.effectiveFrom.getTime() < u && end(v) > f)
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

  // Already so for the whole window: one version, the same value, covering it.
  if (value && overlapping.length === 1) {
    const only = overlapping[0];
    if (same(only, value) && only.effectiveFrom.getTime() <= f && end(only) >= u) return [];
  }
  if (!value && overlapping.length === 0) return [];

  const edits: SpliceOp[] = [];
  const creates: SpliceOp[] = [];
  let reused = false;
  for (const v of overlapping) {
    const starts = v.effectiveFrom.getTime();
    if (starts < f) {
      // It lived before the window: keep that part, and give back the part after it.
      if (end(v) > u) creates.push({ kind: 'create', role: 'tail', from: new Date(u), to: v.effectiveTo, value: { subjectId: v.subjectId, teacherId: v.teacherId } });
      edits.push({ kind: 'close', id: v.id, to: from });
    } else if (end(v) > u) {
      // Starts inside the window and runs past it: it begins when the window ends.
      edits.push({ kind: 'shift', id: v.id, from: new Date(u) });
    } else if (value && !reused && starts === f) {
      // A version that starts exactly now (a correction made the same day):
      // keep the row, change its value — no second version on the same day.
      edits.push({ kind: 'reuse', id: v.id, value, to: until });
      reused = true;
    } else {
      edits.push({ kind: 'delete', id: v.id });
    }
  }
  if (value && !reused) creates.unshift({ kind: 'create', role: 'value', from, to: until, value });
  // Edits before creates: a shifted or closed row frees its effectiveFrom
  // before anything new claims a date (the unique indexes key on it).
  return [...edits, ...creates];
}

export interface SlotKey {
  schoolId: string;
  classSectionId: string;
  dayOfWeek: number;
  periodId: string;
  academicYearId: string;
}

/** Perform a plan from `planSplice`. Returns the id of the version that now holds `from`, if any. */
export async function applySplice(tx: TenantTx, key: SlotKey, ops: SpliceOp[]): Promise<string | null> {
  let live: string | null = null;
  for (const op of ops) {
    if (op.kind === 'close') await tx.timetableSlot.update({ where: { id: op.id }, data: { effectiveTo: op.to } });
    else if (op.kind === 'shift') await tx.timetableSlot.update({ where: { id: op.id }, data: { effectiveFrom: op.from } });
    else if (op.kind === 'delete') await tx.timetableSlot.delete({ where: { id: op.id } });
    else if (op.kind === 'reuse') {
      await tx.timetableSlot.update({ where: { id: op.id }, data: { ...op.value, effectiveTo: op.to } });
      live = op.id;
    } else {
      const row = await tx.timetableSlot.create({ data: { ...key, ...op.value, effectiveFrom: op.from, effectiveTo: op.to } });
      if (op.role === 'value') live = row.id;
    }
  }
  return live;
}
