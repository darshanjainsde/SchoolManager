'use client';
import { useState } from 'react';
import { EyeOff, Image as ImageIcon, Paperclip, Send, ShieldCheck } from 'lucide-react';
import {
  SUPPORT_MODULE_LABEL, SUPPORT_SEVERITY_LABEL, SUPPORT_STATUS_LABEL, SUPPORT_STATUS_LABEL_SCHOOL, SUPPORT_STATUS_TONE,
  SUPPORT_TICKET_TYPE_LABEL, type SupportAttachment, type SupportTicketDetail,
} from '@skoolos/types';
import { IMAGE_ACCEPT, acceptFiles, hoursLeft, openInNewTab, shrinkImage, when } from '@/lib/support';

/**
 * ONE TICKET'S THREAD — shared by the school's Help page and the owner's desk,
 * because it is the same story and two copies of it would drift.
 *
 * What differs is only what the viewer may DO, so that is a prop: the school
 * replies with photos, confirms a fix, reopens inside the window and controls
 * the look-in clock; the owner replies, or keeps a private note. A private
 * note is drawn as one, and a SYSTEM line (consent, console opened, auto-
 * closed) is drawn as the desk speaking, not a person.
 */
export function TicketThread({ ticket, viewer, busy, onComment, onConfirm, onReopen, onLookIn, fileLink }: {
  ticket: SupportTicketDetail;
  viewer: 'SCHOOL' | 'OWNER';
  busy?: boolean;
  /** Resolve when the server has it; the composer clears only then, so a failed send loses nothing. */
  onComment: (body: string, files: File[], visibleToSchool: boolean) => Promise<unknown>;
  onConfirm?: () => void;
  onReopen?: (body: string) => Promise<unknown>;
  onLookIn?: (allow: boolean) => void;
  /** Resolves a stored key to a short-lived link; the thread opens it in a new tab. */
  fileLink: (key: string) => Promise<string>;
}) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [privateNote, setPrivateNote] = useState(false);
  const school = viewer === 'SCHOOL';
  const labels = school ? SUPPORT_STATUS_LABEL_SCHOOL : SUPPORT_STATUS_LABEL;
  const reopening = school && ticket.canReopen && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED');
  const closedForGood = school && ticket.status === 'CLOSED' && !ticket.canReopen;
  const canWrite = !closedForGood;
  const lookIn = hoursLeft(ticket.lookInUntil);
  const tooShort = reopening && body.trim().length < 3;

  const send = async () => {
    const text = body.trim();
    if (!text || tooShort) return;
    try {
      if (reopening && onReopen) await onReopen(text);
      else await onComment(text, files, !privateNote);
      setBody(''); setFiles([]); setFileNote(null); setPrivateNote(false);
    } catch { /* kept: the words and photos stay for another try; the toast is the caller's */ }
  };

  const open = (a: SupportAttachment) => {
    void openInNewTab(() => fileLink(a.key)).catch(() => { /* the toast is the caller's */ });
  };

  return (
    <div className="sk-conthread" data-testid="ticket-thread">
      <header className="sk-conhead">
        <div style={{ minWidth: 0 }}>
          <h3><span className="sk-sup-no">{ticket.ticketNo}</span> {ticket.title}</h3>
          <p className="sk-conmeta">
            {SUPPORT_TICKET_TYPE_LABEL[ticket.type]} · {SUPPORT_MODULE_LABEL[ticket.module]} · {SUPPORT_SEVERITY_LABEL[ticket.severity]}
            {!school && ticket.school ? ` · ${ticket.school.name}` : ''}
            {` · raised by ${ticket.raisedBy.name} · ${when(ticket.createdAt)}`}
          </p>
        </div>
        <span className="sk-pill" data-tone={SUPPORT_STATUS_TONE[ticket.status]}>{labels[ticket.status]}</span>
      </header>

      <div className="sk-conbody">{ticket.body}</div>
      {ticket.attachments.length > 0 && <Files files={ticket.attachments} onOpen={open} />}

      {ticket.context && (
        <dl className="sk-sup-ctx" aria-label="Captured when it was raised">
          {ticket.context.pagePath && <><dt>page</dt><dd>{ticket.context.pagePath}</dd></>}
          <dt>plan</dt><dd>{ticket.context.tier}</dd>
          {ticket.context.browser && <><dt>browser</dt><dd>{ticket.context.browser}</dd></>}
          {ticket.context.appVersion && <><dt>app</dt><dd>{ticket.context.appVersion}</dd></>}
        </dl>
      )}

      <ol className="sk-contimeline">
        {ticket.entries.map((e) => (
          <li
            key={e.id}
            className="sk-conentry"
            data-private={!e.visibleToSchool || undefined}
            data-status={e.statusTo ? '' : undefined}
            data-system={e.authorKind === 'SYSTEM' || undefined}
          >
            <div className="sk-conwho">
              <b>{e.authorKind === 'SYSTEM' ? 'Sckools desk' : e.authorKind === 'OWNER' ? (school ? 'Sckools' : (e.authorName ?? 'Sckools')) : (e.authorName ?? 'School')}</b>
              <span>{e.authorKind === 'SCHOOL' ? 'school' : e.authorKind === 'OWNER' ? 'support' : 'note'}</span>
              <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
              {!e.visibleToSchool && (
                <span className="sk-conprivate"><EyeOff size={11} aria-hidden="true" /> only the desk sees this</span>
              )}
            </div>
            {e.statusTo && (
              <p className="sk-constatus">
                {e.statusFrom ? `${labels[e.statusFrom]} → ` : ''}{labels[e.statusTo]}
              </p>
            )}
            {e.body ? <p className="sk-context">{e.body}</p> : null}
            {e.attachments.length > 0 && <Files files={e.attachments} onOpen={open} />}
          </li>
        ))}
        {ticket.entries.length === 0 && <li className="sk-state">Nothing said yet. Sckools has been told.</li>}
      </ol>

      {school && ticket.canConfirm && onConfirm && (
        <div className="sk-sup-confirm" role="group" aria-label="Is it fixed?">
          <p>Sckools marked this resolved. Is it fixed for you?</p>
          <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={busy} onClick={onConfirm}>Yes, it&apos;s fixed</button>
        </div>
      )}

      {canWrite && (
        <div className="sk-conreply">
          <label className="sk-lab" htmlFor="ticket-reply">
            {reopening ? 'Say what is still wrong' : school ? 'Write to Sckools' : 'Write to the school'}
          </label>
          <textarea
            id="ticket-reply"
            className="sk-input"
            rows={3}
            placeholder={reopening ? 'It came back…' : school ? 'Add what you found, or answer a question…' : privateNote ? 'A note only the desk sees…' : 'Write to the school…'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {school && !reopening && (
            <div className="sk-sup-attach">
              <label className="sk-btn sk-press" data-size="sm">
                <ImageIcon size={14} aria-hidden="true" /> Add photos
                <input
                  type="file" accept={IMAGE_ACCEPT} multiple className="sk-sup-fileinput" aria-label="Add photos" data-testid="reply-files"
                  onChange={async (e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    const small = await Promise.all(picked.map(shrinkImage));
                    const { kept, dropped } = acceptFiles(files, small);
                    setFiles(kept); setFileNote(dropped.length ? dropped.join('; ') : null);
                  }}
                />
              </label>
              {files.map((f) => (
                <span key={f.name + f.size} className="sk-sup-chip">
                  {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>×</button>
                </span>
              ))}
              {fileNote && <span className="sk-sup-filenote">{fileNote}</span>}
            </div>
          )}
          <div className="sk-conactions">
            {!school && (
              <label className="sk-conprivtoggle">
                <input type="checkbox" checked={privateNote} onChange={(e) => setPrivateNote(e.target.checked)} />
                <span>Private note (the school never sees it)</span>
              </label>
            )}
            <span className="sp" style={{ flex: 1 }} />
            <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={busy || !body.trim() || tooShort} onClick={() => void send()}>
              <Send size={14} aria-hidden="true" /> {reopening ? 'Reopen' : privateNote ? 'Add note' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {closedForGood && (
        <p className="sk-state" style={{ margin: 0 }}>This ticket is closed. If it happens again, report a new problem and mention {ticket.ticketNo}.</p>
      )}

      {/* Shown while consent is live even on a closed ticket, so it can always be withdrawn. */}
      {school && onLookIn && (ticket.status !== 'CLOSED' || !!lookIn) && (
        <label className="sk-sup-lookin" data-on={lookIn ? '' : undefined}>
          <input type="checkbox" checked={!!lookIn} disabled={busy} onChange={(e) => onLookIn(e.target.checked)} />
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            <b>Allow Sckools to open our console to investigate</b>
            <small>{lookIn ? `On · ${lookIn}. Every visit is written on this timeline.` : 'For 48 hours. You can switch it off any time.'}</small>
          </span>
        </label>
      )}
    </div>
  );
}

function Files({ files, onOpen }: { files: SupportAttachment[]; onOpen: (a: SupportAttachment) => void }) {
  return (
    <ul className="sk-sup-files" aria-label="Photos">
      {files.map((a) => (
        <li key={a.key}>
          <button type="button" className="sk-sup-file" onClick={() => onOpen(a)}>
            <Paperclip size={12} aria-hidden="true" /> {a.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
