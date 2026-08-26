/**
 * Homecoming — the rules, with no database in sight.
 *
 * Everything here is pure so it can be tested exhaustively and read in one
 * sitting. Three things live in this file because each is a decision somebody
 * will want to challenge later, and a decision buried in a service method is a
 * decision nobody can find:
 *
 *   1. The gift state machine, including the rule that a short pledge cannot be
 *      handed out.
 *   2. The guest-session state machine, including the accompanying-teacher gate
 *      and the one-counter-each cap.
 *   3. Slot availability — which periods an alumnus may ask for, and (kept
 *      strictly separate) what the office is additionally allowed to see.
 */

import type { GiftMode, GiftScope, GiftStatus, GuestSessionStatus } from '@prisma/client';

// ─── Gifts ───────────────────────────────────────────────────────────────────

export type GiftAction =
  | 'ACCEPT'
  | 'DECLINE'
  | 'COUNTER'
  | 'CANCEL'
  | 'RECEIVE'
  | 'DISTRIBUTE'
  | 'REPORT';

/**
 * Legal transitions, exhaustively. Anything not listed is refused — a state
 * machine that falls through to "allow" is not a state machine.
 *
 * COUNTERED goes back to PROPOSED rather than forward: the school suggested a
 * different gift, so the donor is deciding again from the top. It is not a
 * fourth kind of acceptance.
 */
const GIFT_TRANSITIONS: Record<GiftStatus, Partial<Record<GiftAction, GiftStatus>>> = {
  PROPOSED: { ACCEPT: 'ACCEPTED', DECLINE: 'DECLINED', COUNTER: 'COUNTERED', CANCEL: 'CANCELLED' },
  COUNTERED: { ACCEPT: 'ACCEPTED', DECLINE: 'DECLINED', CANCEL: 'CANCELLED' },
  ACCEPTED: { RECEIVE: 'RECEIVED', CANCEL: 'CANCELLED' },
  // RECEIVE again is legal and deliberate: a short delivery is topped up by a
  // second consignment, and each one is its own dated GiftReceipt row.
  RECEIVED: { RECEIVE: 'RECEIVED', DISTRIBUTE: 'DISTRIBUTED', CANCEL: 'CANCELLED' },
  DISTRIBUTED: { REPORT: 'REPORTED' },
  REPORTED: {},
  DECLINED: {},
  CANCELLED: {},
};

export function nextGiftStatus(current: GiftStatus, action: GiftAction): GiftStatus | null {
  return GIFT_TRANSITIONS[current]?.[action] ?? null;
}

export interface ShortfallView {
  /** What the donor agreed to, frozen at pledge time. */
  quantity: number;
  /** Sum of every GiftReceipt against this pledge. */
  received: number;
  /** Positive means goods are still owed. Never negative — see below. */
  short: number;
  /** Over-delivery is fine and is NOT an error; the school keeps the spares. */
  surplus: number;
  canDistribute: boolean;
}

/**
 * The rule the whole feature hangs on: a gift covers everyone in the group it
 * was given to, or it waits.
 *
 * Thirty-eight children in 5-A means thirty-eight sweaters. Never twenty, and
 * never "the ones who need it most" — the moment a classroom is sorted into the
 * given-to and the passed-over, the school has done a child more harm than the
 * sweater did good. So a short pledge stays open and visible instead of being
 * handed out, and anyone (another alumnus, or the school itself) may close it.
 */
export function giftShortfall(quantity: number, received: number): ShortfallView {
  const short = Math.max(0, quantity - received);
  return {
    quantity,
    received,
    short,
    surplus: Math.max(0, received - quantity),
    canDistribute: short === 0 && quantity > 0,
  };
}

/**
 * An in-kind gift never carries a rupee valuation. That keeps donated goods out
 * of the fee ledger — where a valuation would become somebody's audit problem —
 * and it is the school's tax exposure to value them, not ours.
 */
export function amountForMode(mode: GiftMode, unitCostMinor: number, quantity: number): number | null {
  return mode === 'FUND' ? unitCostMinor * quantity : null;
}

/** A pledge addresses a GROUP. It never names, reaches, or filters a child. */
export function assertScopeShape(
  scopeKind: GiftScope,
  gradeId: string | null | undefined,
  classSectionId: string | null | undefined,
): void {
  if (scopeKind === 'SECTION' && !classSectionId) throw new Error('SECTION scope needs classSectionId');
  if (scopeKind === 'GRADE' && !gradeId) throw new Error('GRADE scope needs gradeId');
  if (scopeKind === 'SCHOOL' && (gradeId || classSectionId)) {
    throw new Error('SCHOOL scope must not carry a grade or section');
  }
}

// ─── Guest sessions ──────────────────────────────────────────────────────────

export type SessionAction = 'ACCEPT' | 'COUNTER' | 'DECLINE' | 'CANCEL' | 'DELIVER';

/** Who is taking the action. The same verb means different things from each side. */
export type SessionActor = 'SCHOOL' | 'HOST';

export interface SessionGateContext {
  /**
   * The safeguarding rule, as data. Nothing reaches SCHEDULED without a named
   * member of staff who will be in the room.
   */
  accompanyingTeacherId: string | null | undefined;
  /** How many times the school has already suggested a different time. */
  counterRound: number;
}

export const MAX_COUNTER_ROUNDS = 1;

export interface SessionDecision {
  ok: boolean;
  next?: GuestSessionStatus;
  /** Machine-readable so the API can map it to an ErrorCode, never prose. */
  reason?:
    | 'ILLEGAL_TRANSITION'
    | 'NEEDS_ACCOMPANYING_TEACHER'
    | 'COUNTER_LIMIT_REACHED'
    | 'WRONG_ACTOR';
}

/**
 * Whoever moves last is the one who schedules it.
 *
 * If the school accepts the requested slot, it is booked there and then. If the
 * school suggests another time and the host accepts, THAT acceptance books it —
 * there is no third approval, because the school proposing a time is the school
 * approving it. One counter each, then it becomes a phone call: software that
 * lets two people haggle indefinitely only moves the argument somewhere worse.
 */
export function decideSession(
  current: GuestSessionStatus,
  action: SessionAction,
  actor: SessionActor,
  ctx: SessionGateContext,
): SessionDecision {
  const fail = (reason: SessionDecision['reason']): SessionDecision => ({ ok: false, reason });

  // Either side may walk away from a live request, and only from a live one.
  if (action === 'CANCEL') {
    return current === 'REQUESTED' || current === 'COUNTERED' || current === 'SCHEDULED'
      ? { ok: true, next: 'CANCELLED' }
      : fail('ILLEGAL_TRANSITION');
  }

  if (action === 'DELIVER') {
    if (actor !== 'SCHOOL') return fail('WRONG_ACTOR');
    return current === 'SCHEDULED' ? { ok: true, next: 'DELIVERED' } : fail('ILLEGAL_TRANSITION');
  }

  if (action === 'DECLINE') {
    if (current !== 'REQUESTED' && current !== 'COUNTERED') return fail('ILLEGAL_TRANSITION');
    return { ok: true, next: 'DECLINED' };
  }

  if (action === 'COUNTER') {
    // Only the school suggests another time. A host who cannot make it declines
    // and asks again; letting both sides counter is how you get the haggle.
    if (actor !== 'SCHOOL') return fail('WRONG_ACTOR');
    if (current !== 'REQUESTED') return fail('ILLEGAL_TRANSITION');
    if (ctx.counterRound >= MAX_COUNTER_ROUNDS) return fail('COUNTER_LIMIT_REACHED');
    // The teacher is named when the school moves, which is why the gate below
    // costs the flow nothing: by the time anything is confirmed it is filled.
    if (!ctx.accompanyingTeacherId) return fail('NEEDS_ACCOMPANYING_TEACHER');
    return { ok: true, next: 'COUNTERED' };
  }

  // ACCEPT — the school accepting a REQUESTED slot, or the host accepting the
  // school's COUNTERED one. Both land on SCHEDULED.
  if (current === 'REQUESTED') {
    if (actor !== 'SCHOOL') return fail('WRONG_ACTOR');
    if (!ctx.accompanyingTeacherId) return fail('NEEDS_ACCOMPANYING_TEACHER');
    return { ok: true, next: 'SCHEDULED' };
  }
  if (current === 'COUNTERED') {
    if (actor !== 'HOST') return fail('WRONG_ACTOR');
    // Belt and braces. The school could not have reached COUNTERED without
    // naming a teacher, but a later edit must not be able to blank it.
    if (!ctx.accompanyingTeacherId) return fail('NEEDS_ACCOMPANYING_TEACHER');
    return { ok: true, next: 'SCHEDULED' };
  }
  return fail('ILLEGAL_TRANSITION');
}

// ─── Slot availability ───────────────────────────────────────────────────────

export type SlotState =
  /** The class is in a lesson that may be given up. Requestable. */
  | 'FREE'
  /** Another request already has this period. */
  | 'HELD'
  /** Already booked for a guest. */
  | 'BOOKED'
  /** An exam, or a holiday. Never offered. */
  | 'CLOSED'
  /** Nothing timetabled — there is no lesson here to displace. */
  | 'EMPTY';

export interface SlotView {
  periodId: string;
  periodOrder: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  date: string; // YYYY-MM-DD
  state: SlotState;
  /**
   * ONLY ever populated for an office caller. A full timetable tells an
   * outsider exactly where three hundred children are at every minute of the
   * week, which is a fact about a building rather than a preference about
   * privacy — so `buildSlots` takes the audience explicitly and an alumnus
   * physically cannot receive these fields.
   */
  subjectName?: string;
  teacherName?: string;
  subjectId?: string;
  teacherId?: string;
}

export interface SlotInputs {
  /** Dates in scope, YYYY-MM-DD, already filtered to the school's working days. */
  dates: string[];
  periods: { id: string; order: number; label: string; startTime: string; endTime: string }[];
  /** What this class does, by weekday (1=Mon … 7=Sun) and period. */
  timetable: {
    weekday: number;
    periodId: string;
    subjectId: string | null;
    subjectName: string | null;
    teacherId: string | null;
    teacherName: string | null;
  }[];
  /** YYYY-MM-DD strings the school has marked as holidays. */
  holidays: Set<string>;
  /** YYYY-MM-DD strings covered by an exam for this class. */
  examDates: Set<string>;
  /** `${date}|${periodId}` already spoken for, and by which status. */
  taken: Map<string, 'HELD' | 'BOOKED'>;
}

/** 1 = Monday … 7 = Sunday, matching TimetableSlot.weekday. */
export function isoWeekday(dateYmd: string): number {
  // Constructed as UTC so a machine in IST does not shift the day.
  const d = new Date(`${dateYmd}T00:00:00Z`);
  const js = d.getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

/**
 * The audience is a parameter, not a filter applied afterwards. Redacting a
 * field on the way out is how LIBRARY-TRAPS #17 happened — the strip was
 * correct and the guarantee still failed one join away. Here the ALUMNUS branch
 * never writes the subject onto the object at all.
 */
export function buildSlots(input: SlotInputs, audience: 'ALUMNUS' | 'OFFICE'): SlotView[] {
  const out: SlotView[] = [];
  for (const date of input.dates) {
    const wd = isoWeekday(date);
    const closed = input.holidays.has(date) || input.examDates.has(date);
    for (const p of input.periods) {
      const lesson = input.timetable.find((t) => t.weekday === wd && t.periodId === p.id);
      const takenAs = input.taken.get(`${date}|${p.id}`);
      let state: SlotState;
      if (closed) state = 'CLOSED';
      else if (takenAs) state = takenAs;
      else if (!lesson) state = 'EMPTY';
      else state = 'FREE';

      const view: SlotView = {
        periodId: p.id,
        periodOrder: p.order,
        periodLabel: p.label,
        startTime: p.startTime,
        endTime: p.endTime,
        date,
        state,
      };
      if (audience === 'OFFICE' && lesson) {
        view.subjectName = lesson.subjectName ?? undefined;
        view.teacherName = lesson.teacherName ?? undefined;
        view.subjectId = lesson.subjectId ?? undefined;
        view.teacherId = lesson.teacherId ?? undefined;
      }
      out.push(view);
    }
  }
  return out;
}

/** Requestable means FREE. EMPTY is not offered — there is no lesson to displace,
 *  which usually means the school does not run that period for that class. */
export function isRequestable(state: SlotState): boolean {
  return state === 'FREE';
}

// ─── Graduation ──────────────────────────────────────────────────────────────

export interface GraduationSource {
  id: string;
  admissionNo: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  /** The GUARDIAN's number, and it must be labelled as such wherever it is shown. */
  guardianPhone: string | null;
  className: string | null;
  photoAssetId: string | null;
}

export interface GraduationRow {
  studentId: string;
  admissionNo: string | null;
  firstName: string;
  lastName: string;
  batchYear: number;
  lastClass: string | null;
  email: string | null;
  photoAssetId: string | null;
  /**
   * Deliberately NOT copied into Alumni.phone. The number on file belongs to a
   * parent, and four years from now a school that copied it will be WhatsApping
   * four hundred fathers believing it is reaching its alumni. The claim screen
   * asks the school-leaver for their own.
   */
  guardianPhoneForInvite: string | null;
}

export function toGraduationRows(students: GraduationSource[], batchYear: number): GraduationRow[] {
  return students.map((s) => ({
    studentId: s.id,
    admissionNo: s.admissionNo,
    firstName: s.firstName,
    lastName: s.lastName,
    batchYear,
    lastClass: s.className,
    email: s.email,
    photoAssetId: s.photoAssetId,
    guardianPhoneForInvite: s.guardianPhone,
  }));
}

// ─── Privacy ─────────────────────────────────────────────────────────────────

export const PRIVACY_FIELDS = ['name', 'photo', 'city', 'work', 'college', 'phone'] as const;
export type PrivacyField = (typeof PRIVACY_FIELDS)[number];
export type PrivacyLevel = 'PUBLIC' | 'ALUMNI' | 'BATCH' | 'OFFICE' | 'HIDDEN';

/**
 * An absent key reads as HIDDEN, never as visible. A field added in a later
 * release is therefore closed for every alumnus who has not seen it yet, which
 * is the only safe direction for a default to fail.
 */
export function privacyOf(privacy: unknown, field: PrivacyField): PrivacyLevel {
  if (!privacy || typeof privacy !== 'object') return 'HIDDEN';
  const v = (privacy as Record<string, unknown>)[field];
  const levels: PrivacyLevel[] = ['PUBLIC', 'ALUMNI', 'BATCH', 'OFFICE', 'HIDDEN'];
  return levels.includes(v as PrivacyLevel) ? (v as PrivacyLevel) : 'HIDDEN';
}

/** What a brand-new alumnus starts with: everything closed but the bare identity. */
export function defaultPrivacy(): Record<PrivacyField, PrivacyLevel> {
  return { name: 'ALUMNI', photo: 'HIDDEN', city: 'HIDDEN', work: 'HIDDEN', college: 'HIDDEN', phone: 'HIDDEN' };
}
