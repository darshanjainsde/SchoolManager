/**
 * Shared vocabulary for the owner console's lead pipeline. The API's shapes
 * can't be imported here (the web app never depends on API internals), so the
 * contract is declared once in this file and every /platform page reads it
 * from here rather than re-declaring drifting copies.
 */

/** The stages a lead can be moved to — the board's columns, in order. */
export const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO', 'WON', 'LOST'] as const;

/**
 * CLOSED predates the pipeline and means what LOST now means. The migration
 * deliberately did not rewrite those rows — that would have been irreversible
 * and would have broken the console deployed at the time — so the value still
 * arrives from the API and every read path has to handle it. It is shown under
 * Lost and never offered as a destination, so it drains as leads are worked.
 */
export const LEGACY_STAGE = 'CLOSED';
export type LeadStage = (typeof LEAD_STAGES)[number] | 'CLOSED';

/** Where a stage is displayed. Only CLOSED differs from its own value. */
export function displayColumn(stage: LeadStage): (typeof LEAD_STAGES)[number] {
  return stage === 'CLOSED' ? 'LOST' : stage;
}

/** The stages a lead is still being worked in — everything but the two ends. */
export const OPEN_STAGES: readonly LeadStage[] = ['CONTACTED', 'QUALIFIED', 'DEMO'];

/** Terminal stages — nothing here is still being worked. */
export const DONE_STAGES: readonly LeadStage[] = ['WON', 'LOST', 'CLOSED'];

export const STAGE_LABEL: Record<LeadStage, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  DEMO: 'Demo',
  WON: 'Won',
  LOST: 'Lost',
  CLOSED: 'Closed (legacy)',
};

/**
 * One-line hint shown under an empty column, so the board teaches its own flow.
 * Keyed by COLUMN, not stage — CLOSED has no column of its own.
 */
export const STAGE_HINT: Record<(typeof LEAD_STAGES)[number], string> = {
  NEW: 'Fresh callback requests land here.',
  CONTACTED: 'You have reached out at least once.',
  QUALIFIED: 'A real school with a real need.',
  DEMO: 'Demo booked or already given.',
  WON: 'Signed up — onboard them next.',
  LOST: 'Not a fit, or gone quiet.',
};

export const ACTIVITY_KINDS = ['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_LABEL: Record<ActivityKind | 'STAGE_CHANGE', string> = {
  NOTE: 'Note',
  CALL: 'Call',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  STAGE_CHANGE: 'Stage change',
};

export interface LeadActivityRow {
  id: string;
  kind: ActivityKind | 'STAGE_CHANGE';
  body: string | null;
  fromStatus: LeadStage | null;
  toStatus: LeadStage | null;
  actorId: string | null;
  createdAt: string;
}

export interface Lead {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  school: string | null;
  interest: string | null;
  source: string;
  status: LeadStage;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activityCount: number;
  lastActivityAt: string | null;
}

export interface LeadDetail extends Omit<Lead, 'activityCount' | 'lastActivityAt'> {
  activities: LeadActivityRow[];
}

// ── Formatting ─────────────────────────────────────────────────────────────

/** "3 days ago" / "in 2 days" — the unit a person would actually say. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return 'just now';
  const future = diffMs > 0;
  const say = (n: number, unit: string) =>
    `${future ? 'in ' : ''}${n} ${unit}${n === 1 ? '' : 's'}${future ? '' : ' ago'}`;
  if (mins < 60) return say(mins, 'min');
  const hours = Math.round(mins / 60);
  if (hours < 24) return say(hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 31) return say(days, 'day');
  const months = Math.round(days / 30);
  if (months < 12) return say(months, 'month');
  return say(Math.round(months / 12), 'year');
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** A follow-up is due once its moment has passed, or is "soon" within 48h. */
export function followUpTone(iso: string | null, stage?: LeadStage): 'due' | 'soon' | null {
  if (!iso) return null;
  // A finished lead is never chasing anyone, so it never reads as overdue.
  if (stage && DONE_STAGES.includes(stage)) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'due';
  if (diff <= 48 * 3_600_000) return 'soon';
  return null;
}

/** Strips everything a `tel:` / `wa.me` URL cannot carry. */
export function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/** wa.me wants digits only — no leading +. */
export function whatsappNumber(phone: string): string {
  return dialable(phone).replace(/^\+/, '');
}

/** `datetime-local` needs a local-time "YYYY-MM-DDTHH:mm", not an ISO string. */
export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── CSV export ─────────────────────────────────────────────────────────────

function csvField(v: string | null | undefined): string {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function leadsToCsv(leads: Lead[]): string {
  const header = 'createdAt,name,phone,email,school,interest,source,stage,nextFollowUpAt,lastContactedAt';
  const lines = leads.map((l) =>
    [
      l.createdAt,
      csvField(l.name),
      csvField(l.phone),
      csvField(l.email),
      csvField(l.school),
      csvField(l.interest),
      csvField(l.source),
      l.status,
      l.nextFollowUpAt ?? '',
      l.lastContactedAt ?? '',
    ].join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}

/** Triggers a client-side file download without touching the server. */
export function downloadCsv(filename: string, body: string): void {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
