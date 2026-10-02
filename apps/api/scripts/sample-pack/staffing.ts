import { FIRST_F, FIRST_M, GRADES, SECTIONS, SUBJECTS, SURNAMES, TEACHERS, TeacherDef, weekly } from './data';
import { Rng, makeRng } from './rng';

/**
 * WHO TEACHES WHAT, AND WHEN — worked out, not scattered.
 *
 * A timetable is only believable if three things are true at once: every class
 * has a teacher in every period, no teacher is in two rooms at the same moment,
 * and nobody teaches more periods than a person can. 45 sections × 42 weekly
 * periods is 1,890 lessons, which is why 20 teachers were never going to be
 * enough — each can give about 30. The staffing is therefore DERIVED from the
 * demand: as many teachers of each subject (and level) as the lessons need.
 *
 * Once every (section, subject) has a teacher, the timetable is an edge-colouring
 * problem. Draw a line from each section to each teacher for every lesson the
 * teacher gives it; give each line one of 42 colours (a day-and-period) so that
 * no two lines meeting at the same section or the same teacher share a colour.
 * König's theorem guarantees this is possible whenever no one has more than 42
 * lines, and the alternating-path method below finds it. No teacher is ever
 * double-booked, by construction rather than by luck.
 */
export const DAYS = 6;
export const PER_DAY = 7;
export const CELLS = DAYS * PER_DAY;

export type Tier = 'P' | 'T' | 'S';
export const tierOf = (g: number): Tier => (g <= 7 ? 'P' : g <= 12 ? 'T' : 'S');

export interface PlannedTeacher extends TeacherDef {
  maxLoad: number;
  /** The level they teach: primary & pre-primary, trained graduate (VI–X), post-graduate (XI–XII). ALL for PE and Art. */
  tier: Tier | 'ALL';
  extra: boolean;
}
export interface SectionKey { g: number; letter: string; label: string }
export interface Lesson { section: number; subject: string; teacher: number; count: number }
export interface Slot { section: number; teacher: number; subject: string; day: number; period: number }
export interface Staffing {
  teachers: PlannedTeacher[];
  sections: SectionKey[];
  lessons: Lesson[];
  slots: Slot[];
  load: number[];
}

const NAME = Object.fromEntries(SUBJECTS) as Record<string, string>;
const MAX_LOAD = 30;

function tierOfDesignation(d: string, subjects: string[]): Tier | 'ALL' {
  if (subjects[0] === 'PE' || subjects[0] === 'ART') return 'ALL';
  if (/^TGT/.test(d)) return 'T';
  if (/^PGT|^Vice Principal/.test(d)) return 'S';
  return 'P';
}

const round500 = (n: number) => Math.round(n / 500) * 500;

function newExtra(r: Rng, subject: string, tier: Tier | 'ALL', taken: Set<string>): PlannedTeacher {
  const gender = r.chance(0.55) ? 'F' : 'M';
  let first = ''; let last = '';
  do { first = r.pick(gender === 'F' ? FIRST_F : FIRST_M); last = r.pick(SURNAMES); } while (taken.has(`${first} ${last}`));
  taken.add(`${first} ${last}`);
  const name = NAME[subject]!;
  const t = tier === 'ALL' ? 'P' : tier;
  const designation = subject === 'PE' ? 'Physical Education Teacher' : subject === 'ART' ? 'Art & Craft Teacher'
    : t === 'S' ? `PGT ${name}` : t === 'T' ? `TGT ${name}` : `PRT ${name}`;
  const years = t === 'S' ? r.int(9, 20) : t === 'T' ? r.int(5, 14) : r.int(2, 10);
  const gross = subject === 'PE' || subject === 'ART' ? r.int(34, 44) * 1000
    : t === 'S' ? r.int(58, 78) * 1000 : t === 'T' ? r.int(40, 54) * 1000 : r.int(26, 40) * 1000;
  const joinedYear = 2026 - Math.min(years, 14);
  return {
    first, last, gender, subjects: [subject], designation,
    qualification: t === 'S' ? `Post-graduate in ${name}, B.Ed` : t === 'T' ? `Graduate in ${name}, B.Ed` : 'Graduate, B.El.Ed',
    years, grossRupees: round500(gross), maxLoad: MAX_LOAD, tier, extra: true,
    joined: `${joinedYear}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`.replace(/^2026-(0[4-9]|1.)/, '2025-$1'),
  };
}

/** Everything every section studies, flattened. */
function demand(sections: SectionKey[]) {
  return sections.flatMap((s, i) => Object.entries(weekly(s.g, s.letter)).map(([subject, count]) => ({ section: i, g: s.g, subject, count })));
}

export function planStaffing(seed = 2026_10_02): Staffing {
  const r = makeRng(seed);
  const sections: SectionKey[] = GRADES.flatMap((grade, g) => SECTIONS.map((letter) => ({ g, letter, label: `${grade}-${letter}` })));
  const items = demand(sections);
  for (const [i, s] of sections.entries()) {
    const total = Object.values(weekly(s.g, s.letter)).reduce((a, b) => a + b, 0);
    if (total !== CELLS) throw new Error(`${s.label} has ${total} lessons a week, not ${CELLS}`);
    void i;
  }

  const teachers: PlannedTeacher[] = TEACHERS.map((t, i) => ({
    ...t, maxLoad: i === 0 ? 16 : i === 19 ? 24 : MAX_LOAD, tier: tierOfDesignation(t.designation, t.subjects), extra: false,
  }));
  const taken = new Set(teachers.map((t) => `${t.first} ${t.last}`));

  // Start from the number of teachers the demand needs, then correct from what the assignment finds.
  const need = new Map<string, number>();
  for (const it of items) {
    const key = `${it.subject}|${it.subject === 'PE' || it.subject === 'ART' ? 'ALL' : tierOf(it.g)}`;
    need.set(key, (need.get(key) ?? 0) + it.count);
  }
  for (const [key, total] of need) {
    const [subject, tier] = key.split('|') as [string, Tier | 'ALL'];
    const have = teachers.filter((t) => t.subjects[0] === subject && t.tier === tier).reduce((a, t) => a + t.maxLoad, 0);
    const missing = Math.max(0, Math.ceil((total - have) / MAX_LOAD));
    for (let k = 0; k < missing; k += 1) teachers.push(newExtra(r, subject, tier, taken));
  }

  let lessons: Lesson[] = [];
  let load: number[] = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const out = assign(teachers, sections, items);
    if (out.ok) { lessons = out.lessons; load = out.load; break; }
    teachers.push(newExtra(r, out.subject, out.tier, taken));
    if (attempt === 59) throw new Error('could not staff the school');
  }

  const slots = timetable(sections, teachers, lessons, r);
  return { teachers, sections, lessons, slots, load };
}

function assign(teachers: PlannedTeacher[], sections: SectionKey[], items: ReturnType<typeof demand>) {
  const load = new Array<number>(teachers.length).fill(0);
  const lessons: Lesson[] = [];
  const last = new Map<string, number>();
  const order = [...items].sort((a, b) => a.subject.localeCompare(b.subject) || a.section - b.section);
  for (const it of order) {
    const fits = teachers.map((t, i) => ({ t, i })).filter(({ t, i }) => t.subjects.includes(it.subject) && load[i]! + it.count <= t.maxLoad);
    if (!fits.length) return { ok: false as const, subject: it.subject, tier: (it.subject === 'PE' || it.subject === 'ART' ? 'ALL' : tierOf(it.g)) as Tier | 'ALL' };
    const tier = tierOf(it.g);
    const matched = fits.filter(({ t }) => t.tier === 'ALL' || t.tier === tier);
    const pool = matched.length ? matched : fits;
    // The same teacher takes a grade's sections for a subject (Maths for all three Class Vs), if they have room.
    const sticky = last.get(`${it.subject}|${it.g}`);
    const pick = pool.find(({ i }) => i === sticky) ?? pool.reduce((a, b) => (load[a.i]! <= load[b.i]! ? a : b));
    load[pick.i]! += it.count;
    last.set(`${it.subject}|${it.g}`, pick.i);
    lessons.push({ section: it.section, subject: it.subject, teacher: pick.i, count: it.count });
  }
  return { ok: true as const, lessons, load };
}

/** Bipartite edge-colouring by alternating paths: every lesson gets a cell, no clashes. */
function timetable(sections: SectionKey[], teachers: PlannedTeacher[], lessons: Lesson[], r: Rng): Slot[] {
  const S = sections.length; const T = teachers.length; const K = CELLS;
  type Edge = { u: number; v: number; subject: string; section: number; teacher: number; color: number };
  const edges: Edge[] = [];
  for (const l of lessons) for (let k = 0; k < l.count; k += 1) edges.push({ u: l.section, v: S + l.teacher, subject: l.subject, section: l.section, teacher: l.teacher, color: -1 });
  const at = new Int32Array((S + T) * K).fill(-1);
  const free = (x: number) => { for (let c = 0; c < K; c += 1) if (at[x * K + c] === -1) return c; throw new Error('no free colour'); };
  const put = (id: number, c: number) => { const e = edges[id]!; e.color = c; at[e.u * K + c] = id; at[e.v * K + c] = id; };
  const clear = (id: number) => { const e = edges[id]!; at[e.u * K + e.color] = -1; at[e.v * K + e.color] = -1; e.color = -1; };

  for (const id of r.shuffle(edges.map((_, i) => i))) {
    const e = edges[id]!;
    const a = free(e.u); const b = free(e.v);
    if (at[e.v * K + a] === -1) { put(id, a); continue; }
    if (at[e.u * K + b] === -1) { put(id, b); continue; }
    // Walk the a/b alternating path from v, swap its colours, and a is free at v.
    const path: number[] = [];
    let x = e.v; let c = a;
    while (at[x * K + c] !== -1) {
      const pid = at[x * K + c]!;
      path.push(pid);
      const pe = edges[pid]!;
      x = pe.u === x ? pe.v : pe.u;
      c = c === a ? b : a;
    }
    const was = path.map((pid) => edges[pid]!.color);
    for (const pid of path) clear(pid);
    path.forEach((pid, i) => put(pid, was[i] === a ? b : a));
    put(id, a);
  }

  // Which colour is Monday-first-period and which is Saturday-last is arbitrary —
  // so choose the arrangement that spreads each subject across the week (a class
  // should not have four Hindi periods on Tuesday and none on Thursday).
  const subjects = [...new Set(lessons.map((l) => l.subject))];
  const sIdx = new Map(subjects.map((s, i) => [s, i]));
  const cap = new Map<string, number>(); // `${section}|${subject}` → at most this many a day
  for (const l of lessons) cap.set(`${l.section}|${l.subject}`, Math.ceil(l.count / DAYS));
  let perm = Array.from({ length: K }, (_, i) => i);
  const cost = (p: number[]) => {
    const n = new Int16Array(S * DAYS * subjects.length);
    for (const e of edges) n[(e.section * DAYS + Math.floor(p[e.color]! / PER_DAY)) * subjects.length + sIdx.get(e.subject)!]! += 1;
    let c = 0;
    for (let s = 0; s < S; s += 1) for (let d = 0; d < DAYS; d += 1) for (const subj of subjects) {
      const over = n[(s * DAYS + d) * subjects.length + sIdx.get(subj)!]! - (cap.get(`${s}|${subj}`) ?? 0);
      if (over > 0) c += over;
    }
    return c;
  };
  let best = cost(perm);
  for (let it = 0; it < 4000 && best > 0; it += 1) {
    const i = r.int(0, K - 1); const j = r.int(0, K - 1);
    if (i === j || Math.floor(perm[i]! / PER_DAY) === Math.floor(perm[j]! / PER_DAY)) continue;
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
    const c = cost(perm);
    if (c <= best) best = c; else [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }

  const slots = edges.map((e) => ({ section: e.section, teacher: e.teacher, subject: e.subject, day: Math.floor(perm[e.color]! / PER_DAY) + 1, period: perm[e.color]! % PER_DAY }));
  verify(slots, sections, teachers, lessons);
  return slots;
}

/** The three promises a timetable has to keep, checked rather than assumed. */
export function verify(slots: Slot[], sections: SectionKey[], teachers: PlannedTeacher[], lessons: Lesson[]): void {
  const cls = new Set<string>(); const tch = new Set<string>();
  for (const s of slots) {
    const a = `${s.section}|${s.day}|${s.period}`; const b = `${s.teacher}|${s.day}|${s.period}`;
    if (cls.has(a)) throw new Error(`a class has two lessons at ${a}`);
    if (tch.has(b)) throw new Error(`a teacher is double-booked at ${b} (${teachers[s.teacher]!.first})`);
    cls.add(a); tch.add(b);
  }
  for (let i = 0; i < sections.length; i += 1) {
    const n = slots.filter((s) => s.section === i).length;
    if (n !== CELLS) throw new Error(`${sections[i]!.label} has ${n} periods, not ${CELLS}`);
  }
  for (const l of lessons) {
    const n = slots.filter((s) => s.section === l.section && s.subject === l.subject && s.teacher === l.teacher).length;
    if (n !== l.count) throw new Error(`section ${l.section} ${l.subject}: ${n} periods, wanted ${l.count}`);
  }
}
