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

/**
 * These four unions are declared here rather than imported from
 * '@prisma/client', and that is deliberate on two counts.
 *
 * The honest one: this file's whole point is that it has no database in it, and
 * a type import from the generated client is a database dependency wearing a
 * type's clothes. Every other file in apps/api goes through '@skoolos/db' or
 * '@skoolos/types'; this one had become the single exception.
 *
 * The expensive one: it broke the Vercel build three times. `tsc` and the local
 * `ncc` bundle both passed, because a generated client was already sitting in
 * node_modules from an earlier `prisma generate`. On a clean CI checkout the
 * bundle runs before the generated client is where apps/api resolves it, and
 * every one of these members is missing. A local green bundle is not evidence
 * that a cold one builds — LIBRARY-TRAPS #9, "a gate covers less than you
 * assume", in its most literal form.
 *
 * `homecoming-rules.spec.ts` asserts these stay identical to the Prisma enums,
 * so drift is caught by a test rather than by a caller. A spec is never
 * bundled, so it may import the client freely.
 */
export type GiftMode = 'FUND' | 'SUPPLY';
export type GiftScope = 'SCHOOL' | 'GRADE' | 'SECTION';
export type GiftStatus =
  | 'PROPOSED' | 'ACCEPTED' | 'DECLINED' | 'COUNTERED' | 'CANCELLED'
  | 'PICKUP_REQUESTED' | 'PICKED_UP'
  | 'RECEIVED' | 'PURCHASED' | 'DISTRIBUTED' | 'REPORTED';
export type GiftAttachmentKind = 'BILL' | 'CONSIGNMENT' | 'DISTRIBUTION';
export type GuestSessionStatus =
  | 'REQUESTED' | 'COUNTERED' | 'SCHEDULED' | 'DECLINED' | 'CANCELLED' | 'DELIVERED';

// ─── Gifts ───────────────────────────────────────────────────────────────────

export type GiftAction =
  | 'ACCEPT'
  | 'DECLINE'
  | 'COUNTER'
  | 'CANCEL'
  | 'REQUEST_PICKUP'
  | 'MARK_PICKED_UP'
  | 'RECEIVE'
  | 'PURCHASE'
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
/**
 * Legal transitions, exhaustively, and DIFFERENT PER MODE. Anything not listed
 * is refused — a state machine that falls through to "allow" is not one.
 *
 * The two tracks exist because the journeys genuinely differ. Money arrives in
 * an account and is then spent; goods have to be collected, carried, and
 * confirmed. Modelling both with one row of statuses produced a screen that
 * asked a donor who had posted sweaters whether the school had "purchased"
 * them.
 *
 *   FUND    ACCEPTED → RECEIVED(money in) → PURCHASED → DISTRIBUTED
 *   SUPPLY  ACCEPTED → PICKUP_REQUESTED → PICKED_UP → RECEIVED(arrived)
 *                                                   → DISTRIBUTED
 *
 * Both converge on RECEIVED, which means the same thing on either side: it is
 * HERE. That is also what a GiftReceipt row records, so the shortfall rule
 * keeps working untouched across both.
 *
 * COUNTERED goes back to the donor rather than forward — the school suggested
 * something different, so they are deciding again from the top.
 */
type Table = Record<GiftStatus, Partial<Record<GiftAction, GiftStatus>>>;

/** True of both tracks: nothing is settled until the office has accepted. */
const HEAD: Pick<Table, 'PROPOSED' | 'COUNTERED' | 'DECLINED' | 'CANCELLED'> = {
  PROPOSED: { ACCEPT: 'ACCEPTED', DECLINE: 'DECLINED', COUNTER: 'COUNTERED', CANCEL: 'CANCELLED' },
  COUNTERED: { ACCEPT: 'ACCEPTED', DECLINE: 'DECLINED', CANCEL: 'CANCELLED' },
  DECLINED: {},
  CANCELLED: {},
};

/** Shared tail: once it is here, it is counted, handed out and reported on. */
const TAIL = {
  // RECEIVE again is legal and deliberate: a short delivery is topped up by a
  // second consignment, and each one is its own dated GiftReceipt row.
  DISTRIBUTED: { REPORT: 'REPORTED' as GiftStatus },
  REPORTED: {},
} as const;

const FUND_TRANSITIONS: Table = {
  ...HEAD,
  ACCEPTED: { RECEIVE: 'RECEIVED', CANCEL: 'CANCELLED' },
  RECEIVED: { RECEIVE: 'RECEIVED', PURCHASE: 'PURCHASED', CANCEL: 'CANCELLED' },
  // A school that has already SPENT the money cannot cancel — refunding is a
  // conversation, not a state transition, and pretending otherwise would leave
  // the books saying something that is not true.
  PURCHASED: { DISTRIBUTE: 'DISTRIBUTED' },
  PICKUP_REQUESTED: {},
  PICKED_UP: {},
  ...TAIL,
};

const SUPPLY_TRANSITIONS: Table = {
  ...HEAD,
  // RECEIVE straight from ACCEPTED is not an oversight: plenty of gifts arrive
  // in the donor's own car, and forcing a pickup that never happened would make
  // the history a fiction.
  ACCEPTED: { REQUEST_PICKUP: 'PICKUP_REQUESTED', RECEIVE: 'RECEIVED', CANCEL: 'CANCELLED' },
  PICKUP_REQUESTED: { MARK_PICKED_UP: 'PICKED_UP', RECEIVE: 'RECEIVED', CANCEL: 'CANCELLED' },
  // Only the school moves it out of PICKED_UP. A courier marking itself
  // delivered is not the school having the goods.
  PICKED_UP: { RECEIVE: 'RECEIVED', CANCEL: 'CANCELLED' },
  RECEIVED: { RECEIVE: 'RECEIVED', DISTRIBUTE: 'DISTRIBUTED', CANCEL: 'CANCELLED' },
  PURCHASED: {},
  ...TAIL,
};

export function nextGiftStatus(
  current: GiftStatus,
  action: GiftAction,
  mode: GiftMode,
): GiftStatus | null {
  const table = mode === 'FUND' ? FUND_TRANSITIONS : SUPPLY_TRANSITIONS;
  return table[current]?.[action] ?? null;
}

/**
 * The journey a donor is shown, in order, for their mode.
 *
 * Returned as a list rather than derived in the UI so that both the portal and
 * the office read the same sequence — a progress bar that disagrees with the
 * state machine is worse than no progress bar.
 */
export function giftJourney(mode: GiftMode): GiftStatus[] {
  return mode === 'FUND'
    ? ['PROPOSED', 'ACCEPTED', 'RECEIVED', 'PURCHASED', 'DISTRIBUTED']
    : ['PROPOSED', 'ACCEPTED', 'PICKUP_REQUESTED', 'PICKED_UP', 'RECEIVED', 'DISTRIBUTED'];
}

/** Where a pledge has got to along its journey, for a progress indicator.
 *  -1 for a pledge that ended early (declined or cancelled). */
export function giftJourneyIndex(status: GiftStatus, mode: GiftMode): number {
  if (status === 'DECLINED' || status === 'CANCELLED') return -1;
  if (status === 'REPORTED') return giftJourney(mode).length - 1;
  // COUNTERED sits back at the donor's end of the journey, not partway along.
  if (status === 'COUNTERED') return 0;
  return giftJourney(mode).indexOf(status);
}

/** What each step says to the person who gave. Plain words, and never the
 *  internal name of the state. */
export function giftStatusLabel(status: GiftStatus, mode: GiftMode): string {
  switch (status) {
    case 'PROPOSED': return 'Offered — waiting for the school';
    case 'ACCEPTED': return mode === 'FUND' ? 'Accepted — awaiting your payment' : 'Accepted — arranging collection';
    case 'COUNTERED': return 'The school suggested something different';
    case 'DECLINED': return 'Not taken up';
    case 'CANCELLED': return 'Cancelled';
    case 'PICKUP_REQUESTED': return 'Collection arranged';
    case 'PICKED_UP': return 'On its way';
    case 'RECEIVED': return mode === 'FUND' ? 'Funds received' : 'Arrived at the school';
    case 'PURCHASED': return 'Bought by the school';
    case 'DISTRIBUTED': return 'Given to the children';
    case 'REPORTED': return 'Reported back';
    default: return status;
  }
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

export interface PriceCheck {
  ok: boolean;
  /** What to store. Null for SUPPLY, always. */
  unitPriceMinor: number | null;
  amountMinor: number | null;
  /** Addressed to the donor, in their words, when ok is false. */
  problem?: string;
}

/**
 * What a donor typed, checked against what they said they were doing.
 *
 * The price field is where the two modes actually meet: a donor who enters a
 * figure is funding a purchase, and one who enters nothing (or zero) is sending
 * the goods. Rather than let those disagree silently, the pair is validated
 * together and the zero is given a MEANING instead of being treated as a
 * mistake — "0 means you are sending it yourself" is the sentence on the form.
 *
 * A funded gift with no price is the case worth catching: it produces a pledge
 * the school cannot bank, cannot buy against, and cannot chase.
 */
export function priceForPledge(
  mode: GiftMode,
  unitPriceMinor: number | null | undefined,
  quantity: number,
): PriceCheck {
  const typed = unitPriceMinor ?? 0;
  if (typed < 0) {
    return { ok: false, unitPriceMinor: null, amountMinor: null, problem: 'A price cannot be negative.' };
  }
  if (mode === 'SUPPLY') {
    // Not an error, and deliberately not stored either — see amountForMode.
    return { ok: true, unitPriceMinor: null, amountMinor: null };
  }
  if (typed === 0) {
    return {
      ok: false,
      unitPriceMinor: null,
      amountMinor: null,
      problem: 'Enter what you would like to contribute per child, or choose "I will send the goods" instead.',
    };
  }
  if (quantity <= 0) {
    return { ok: false, unitPriceMinor: null, amountMinor: null, problem: 'There is nobody in that group yet.' };
  }
  return { ok: true, unitPriceMinor: typed, amountMinor: typed * quantity };
}

/**
 * Whether a gift still needs collecting, and therefore whether the pickup
 * questions are worth asking at all.
 *
 * Funded gifts never do — the school buys locally — and asking a donor in
 * Toronto for a pickup address for money is how a form loses somebody.
 */
export function needsCollection(mode: GiftMode, status: GiftStatus): boolean {
  if (mode !== 'SUPPLY') return false;
  return status === 'ACCEPTED' || status === 'PICKUP_REQUESTED';
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
  dob: Date | null;
  guardianName: string | null;
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
  /** Carried so a later self-registration can be matched by machine rather than
   *  by a clerk walking to a shelf. Office-only, forever. */
  dob: Date | null;
  guardianName: string | null;
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
    dob: s.dob,
    guardianName: s.guardianName,
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

// ─── Matching a claim to the roll ────────────────────────────────────────────

export interface ClaimFacts {
  firstName: string;
  lastName: string;
  batchYear: number;
  dob: Date | null;
}

export interface RollCandidate {
  id: string;
  firstName: string;
  lastName: string;
  batchYear: number;
  dob: Date | null;
  admissionNo: string | null;
  guardianName: string | null;
  status: string;
}

export interface MatchScore {
  candidateId: string;
  /** What actually lined up, in words, because the office is deciding — not the
   *  computer. A score with no reasons is a number somebody either trusts
   *  blindly or ignores entirely. */
  reasons: string[];
  /** STRONG = name and year and date of birth. A clerk can act on it.
   *  WEAK    = name and year only, which every sibling and namesake also has. */
  strength: 'STRONG' | 'WEAK';
}

const sameDay = (a: Date | null, b: Date | null): boolean =>
  !!a && !!b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Suggest which rows on the roll a claim might be.
 *
 * This NEVER decides anything. It hands the office a shortlist and says why,
 * and a human presses the button — which is the whole design of the
 * verification ladder and the reason claims live in their own table.
 *
 * Date of birth is what makes a suggestion worth reading: name-and-year alone
 * matches every sibling, cousin and namesake in a batch, and a school of three
 * hundred has several. So a match without a date of birth is reported WEAK
 * rather than left to look like the same thing.
 */
export function matchClaimToRoll(claim: ClaimFacts, roll: RollCandidate[]): MatchScore[] {
  const out: MatchScore[] = [];
  for (const c of roll) {
    if (c.batchYear !== claim.batchYear) continue;
    const nameHit = sameName(c.firstName, claim.firstName) && sameName(c.lastName, claim.lastName);
    const dobHit = sameDay(c.dob, claim.dob);
    // A date of birth alone is enough to shortlist: somebody who married and
    // changed their surname is exactly the person the paper register loses.
    if (!nameHit && !dobHit) continue;

    const reasons: string[] = [];
    if (nameHit) reasons.push('name matches the roll');
    else reasons.push('name differs — married name, or a spelling');
    reasons.push(`left in ${c.batchYear}`);
    // Three different situations, and a clerk acts differently on each. Saying
    // "does NOT match" when the claimant simply left the field blank is the
    // wording that gets a real alumnus declined.
    if (dobHit) reasons.push('date of birth matches the student record');
    else if (!claim.dob) reasons.push('claimant gave no date of birth');
    else if (c.dob) reasons.push('date of birth does NOT match');
    else reasons.push('no date of birth on file to check');

    out.push({
      candidateId: c.id,
      reasons,
      strength: nameHit && dobHit ? 'STRONG' : 'WEAK',
    });
  }
  // Strong suggestions first; a clerk reads the top of a list.
  return out.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'STRONG' ? -1 : 1)).slice(0, 5);
}
