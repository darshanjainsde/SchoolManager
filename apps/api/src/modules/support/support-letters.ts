import type { Letter } from '../../common/mail/letterhead';

/**
 * The words the desk sends, kept pure so a spec can read them without a
 * mailbox. The owner gets a letter (through the platform mailbox); the school
 * admin gets an in-app row and an outbox row the drain turns into email/push.
 */

export type OwnerAlertKind = 'RAISED' | 'REPLIED' | 'REOPENED';

export interface OwnerAlertFacts {
  ticketNo: string;
  title: string;
  schoolName: string;
  severityLabel: string;
  moduleLabel: string;
  typeLabel: string;
  by: string;
  preview: string;
  url: string;
}

export function ownerAlertLetter(kind: OwnerAlertKind, t: OwnerAlertFacts): { subject: string; letter: Letter } {
  const verb = kind === 'RAISED' ? 'raised' : kind === 'REPLIED' ? 'replied on' : 'reopened';
  const subject = `${t.ticketNo} · ${t.schoolName} ${verb}: ${t.title}`;
  const intro =
    kind === 'RAISED'
      ? `${t.by} at ${t.schoolName} raised a ticket.`
      : kind === 'REPLIED'
        ? `${t.by} at ${t.schoolName} replied on ${t.ticketNo}.`
        : `${t.by} at ${t.schoolName} reopened ${t.ticketNo}.`;
  return {
    subject,
    letter: {
      title: `${t.ticketNo} · ${t.title}`,
      preheader: `${t.schoolName} · ${t.severityLabel} · ${t.moduleLabel}`,
      intro,
      rows: [
        { label: 'School', value: t.schoolName },
        { label: 'Kind', value: t.typeLabel },
        { label: 'Module', value: t.moduleLabel },
        { label: 'Severity', value: t.severityLabel },
        { label: 'From', value: t.by },
      ],
      quote: t.preview,
      cta: { label: 'Open the ticket', url: t.url },
      tone: t.severityLabel === 'Blocking us today' ? 'alert' : 'default',
    },
  };
}

export type SchoolUpdateKind = 'ACKNOWLEDGED' | 'STATUS' | 'REPLIED' | 'RESOLVED' | 'OPENED';

/** Title + body for the school admin's bell row and the outbox payload. */
export function schoolUpdateText(
  kind: SchoolUpdateKind,
  t: { ticketNo: string; title: string; statusLabel?: string },
): { title: string; body: string } {
  const body = `${t.ticketNo} · ${t.title}`;
  switch (kind) {
    case 'ACKNOWLEDGED':
      return { title: 'Sckools picked up your ticket', body };
    case 'REPLIED':
      return { title: 'Sckools replied on your ticket', body };
    case 'RESOLVED':
      return { title: 'Sckools marked your ticket resolved', body: `${body} · tell us if it is fixed, or reopen it` };
    case 'OPENED':
      return { title: 'Sckools opened your console to investigate', body };
    case 'STATUS':
    default:
      return { title: `Your ticket is now ${t.statusLabel ?? 'updated'}`.replace(/\s+$/, ''), body };
  }
}
