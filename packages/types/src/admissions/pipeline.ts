/**
 * THE ADMISSIONS PIPELINE — one set of rules for the API that enforces them
 * and the desk that draws them.
 *
 * Before this, any stage could be set from any other, backwards included, and
 * the desk drew every stage as a button. A family "Visited" last week could be
 * clicked back to "New" by a slip of the mouse, and the history would say so.
 * The road now runs one way; LOST is the only exit and CONTACTED the only way
 * back in.
 */

/** Every value `Enquiry.status` may hold. CLOSED is the retired three-state word, read as Lost and never written. */
export const ENQUIRY_STAGES = ['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED', 'LOST', 'CLOSED'] as const;
export type EnquiryStageValue = (typeof ENQUIRY_STAGES)[number];

/** The forward road, in the order a family walks it. LOST and CLOSED are off it. */
export const STAGE_ORDER = ['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED'] as const;
export type PipelineStage = (typeof STAGE_ORDER)[number];

/** Where a lead came from — `Enquiry.source`. */
export const ENQUIRY_SOURCES = ['WEBSITE', 'COURSE_CARD', 'WALK_IN', 'PHONE', 'WHATSAPP', 'REFERRAL'] as const;
export type EnquirySourceValue = (typeof ENQUIRY_SOURCES)[number];

/** What `POST /public/enquiry` may claim. A stranger cannot say they walked in. */
export const PUBLIC_SOURCES = ['WEBSITE', 'COURSE_CARD'] as const;
export type PublicSource = (typeof PUBLIC_SOURCES)[number];

/** What the desk's own "Add enquiry" may claim. WHATSAPP and REFERRAL wait for the inbox and a referral field. */
export const DESK_SOURCES = ['WALK_IN', 'PHONE'] as const;
export type DeskSource = (typeof DESK_SOURCES)[number];

export const ENQUIRY_SOURCE_LABEL: Record<EnquirySourceValue, string> = {
  WEBSITE: 'Website',
  COURSE_CARD: 'Course card',
  WALK_IN: 'Walk-in',
  PHONE: 'Phone',
  WHATSAPP: 'WhatsApp',
  REFERRAL: 'Referral',
};

/** `EnquiryNote.kind` values that record somebody reaching the family. */
export const CONTACT_KINDS = ['CALL', 'WHATSAPP', 'VISIT'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** The answers after a contact — the desk's sheet now, the WhatsApp buttons in Tier B. */
export const CONTACT_OUTCOMES = ['CONTACTED', 'INTERESTED', 'NO_ANSWER', 'LOST'] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export type StageMove = 'SAME' | 'FORWARD' | 'LOSE' | 'REOPEN' | 'BACKWARDS';

const isLost = (s: EnquiryStageValue): boolean => s === 'LOST' || s === 'CLOSED';
const rank = (s: EnquiryStageValue): number => (STAGE_ORDER as readonly string[]).indexOf(s);

/** What kind of move `from → to` is. The API refuses BACKWARDS with 409 ENQUIRY_STAGE_BACKWARDS. */
export function stageMove(from: EnquiryStageValue, to: EnquiryStageValue): StageMove {
  if (from === to) return 'SAME';
  if (to === 'CLOSED') return 'BACKWARDS';
  if (to === 'LOST') return 'LOSE';
  if (isLost(from)) return to === 'CONTACTED' ? 'REOPEN' : 'BACKWARDS';
  return rank(to) > rank(from) ? 'FORWARD' : 'BACKWARDS';
}

/** The stages a desk button may move to from here. A lost lead has none — it is reopened instead. */
export function forwardStages(from: EnquiryStageValue): PipelineStage[] {
  if (isLost(from)) return [];
  return STAGE_ORDER.filter((s) => rank(s) > rank(from));
}

/**
 * The stage a logged contact moves a lead to, or null for none.
 *
 * NO_ANSWER moves nothing: a call that rang out did not contact anybody, and a
 * NEW lead that read "Contacted" after it would drop out of the never-contacted
 * count — the one that tells the office who has not been rung.
 */
export function contactTarget(from: EnquiryStageValue, outcome?: ContactOutcome): EnquiryStageValue | null {
  if (outcome === 'NO_ANSWER') return null;
  if (outcome === 'LOST') return isLost(from) ? null : 'LOST';
  if (outcome === 'INTERESTED') return stageMove(from, 'INTERESTED') === 'FORWARD' ? 'INTERESTED' : null;
  return from === 'NEW' ? 'CONTACTED' : null;
}

/** Somebody who may own a lead: an active admissions officer, or a school admin. */
export interface EnquiryDeskMember {
  userId: string;
  name: string;
  job: 'ADMISSIONS' | 'ADMIN';
}
