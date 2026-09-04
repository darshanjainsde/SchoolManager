/**
 * What is still owed, per module.
 *
 * Kept as a source file rather than a table because it is engineering state,
 * not tenant data: it belongs in review next to the code it describes, it
 * changes in the same pull request that closes an item, and a CRUD screen
 * nobody asked for would rot the moment someone forgot to tick a box.
 *
 * Rules for entries:
 *   - `blockedOn` names a PERSON or an external party when the item cannot be
 *     started, and is null when it is purely engineering work.
 *   - `why` says what breaks or stays impossible while it is open — an item
 *     that cannot answer that is not a task, it is a wish.
 */

export type WorkStatus =
  /** Nothing stops this being picked up today. */
  | 'READY'
  /** Waiting on a decision or an answer from outside the codebase. */
  | 'BLOCKED'
  /** Shipped, but knowingly incomplete — the gap is written down below. */
  | 'PARTIAL';

export interface WorkItem {
  id: string;
  module: string;
  title: string;
  why: string;
  needs: string;
  status: WorkStatus;
  blockedOn: string | null;
}

export const REMAINING_WORK: WorkItem[] = [
  // ── Fees ──────────────────────────────────────────────────────────────────
  {
    id: 'fees-notifications',
    module: 'Fees',
    title: 'Nobody is told when a payment is confirmed or turned down',
    why:
      'A parent who sends a screenshot gets no message when the office accepts it — the receipt only appears if they come back and look. The copy was corrected so the product no longer claims otherwise, but the silence is real.',
    needs:
      'A payload type, a MailService composer and a case in both the email and push channels, per kind (verified, rejected, bill issued, due reminder). Email and push only reach families with the app or an address on file, so WhatsApp is the decision that makes it actually useful.',
    status: 'BLOCKED',
    blockedOn: 'WhatsApp Business API + TRAI DLT registration',
  },
  {
    id: 'fees-day-book',
    module: 'Fees',
    title: 'No day book, and no day close',
    why:
      '"Collected today" opens the verify desk\'s Verified tab as a stand-in. There is no per-day view split by method, and no step where a clerk declares the cash in the drawer against what was recorded — which is the step a school\'s auditor asks for.',
    needs: 'One endpoint for the day, one screen, and a small table for the close.',
    status: 'READY',
    blockedOn: null,
  },
  {
    id: 'fees-billing-breakdown',
    module: 'Fees',
    title: 'No breakdown of what was billed',
    why:
      '"Billed this session" opens the student list. There is no view by category or by class, so "did the bulk generation do what I expected" can only be answered student by student.',
    needs: 'One endpoint aggregating by term, class and category; one screen.',
    status: 'READY',
    blockedOn: null,
  },
  {
    id: 'fees-mobile',
    module: 'Fees',
    title: 'Fees do not exist in the mobile app',
    why:
      'The parent web pages are done and /me/fees works, but most parents in Rajasthan will meet this on a phone. Until the screens exist, the app is the surface where fees are invisible.',
    needs: 'React Native screens for dues, bank details, proof upload and status.',
    status: 'READY',
    blockedOn: null,
  },
  {
    id: 'fees-late-fee-waiver',
    module: 'Fees',
    title: 'A late fee cannot be waived for one family',
    why:
      'The rule is school-wide. The first genuine hardship case has no escape hatch short of editing the ledger, which is append-only by design — so it becomes a support call.',
    needs: 'A per-invoice waiver with a reason, on the verify desk or the student ledger.',
    status: 'BLOCKED',
    blockedOn: 'Darshan — whether to add it at all',
  },
  {
    id: 'fees-phonepe',
    module: 'Fees',
    title: 'Online payment is switched off',
    why:
      'The Pay Now button ships visible and disabled. Bank transfer collects real money today, but every school is doing manual verification until a gateway is live.',
    needs:
      'Four answers from PhonePe (V1 or V2 credentials; one credential set plus per-school MID or a full set each; is there a sub-merchant onboarding API; can *.sckools.com be one wildcard). Then FEES_SECRET_KEY on Vercel and the adapter\'s start().',
    status: 'BLOCKED',
    blockedOn: 'PhonePe onboarding',
  },

  // ── Platform ──────────────────────────────────────────────────────────────
  {
    id: 'prod-role-passwords',
    module: 'Platform',
    title: 'Production database roles may still hold the passwords from the migration',
    why:
      'skoolos_app_pw / skoolos_platform_pw are written in 20260703_000100_rls_and_roles, which is in the repository. Tolerable while the database held attendance; not once it holds fee ledgers and bank references. This is the only item from the August schema audit never closed.',
    needs: 'Confirm the live roles, and rotate them if they match.',
    status: 'READY',
    blockedOn: null,
  },
  {
    id: 'prod-required-reviewer',
    module: 'Platform',
    title: 'A production migration can be dispatched with nobody reviewing it',
    why:
      'The production GitHub Environment has no required reviewer, so one person can apply schema changes to the live database alone. Fine for a website change; not for a table holding money.',
    needs: 'Add a required reviewer to the production environment.',
    status: 'READY',
    blockedOn: null,
  },
];

export const STATUS_LABEL: Record<WorkStatus, string> = {
  READY: 'Ready to build',
  BLOCKED: 'Waiting on someone',
  PARTIAL: 'Shipped incomplete',
};

/** Light-only console: these are Tailwind classes, not sk-* tokens. */
export const STATUS_CLASS: Record<WorkStatus, string> = {
  READY: 'bg-teal-50 text-teal-700 ring-teal-600/20',
  BLOCKED: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  PARTIAL: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};
