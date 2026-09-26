'use client';
import { useState } from 'react';
import { CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL, CONCERN_STATUS_TONE, type ConcernDetail, type ConcernStatus } from '@skoolos/types';
import { EyeOff, Send, SendHorizonal } from 'lucide-react';

/**
 * ONE CONCERN'S THREAD — shared by the office, the class teacher and the
 * family, because it is the same story and three copies of it would drift.
 *
 * What differs is only what the viewer may DO, so that is a prop rather than
 * three components: the school can add a private note and move the status,
 * the family can reply and (inside the window) reopen. A private note is
 * drawn as one — the school must be able to see at a glance which lines the
 * family can read.
 */
export function ConcernThread({ concern, viewer, busy, onComment, onStatus, onEscalate, onReopen }: {
  concern: ConcernDetail;
  viewer: 'ADMIN' | 'TEACHER' | 'FAMILY';
  busy?: boolean;
  onComment: (body: string, visibleToFamily: boolean) => void;
  onStatus?: (status: ConcernStatus) => void;
  onEscalate?: () => void;
  onReopen?: (body: string) => void;
}) {
  const [body, setBody] = useState('');
  const [privateNote, setPrivateNote] = useState(false);
  const school = viewer !== 'FAMILY';
  const canWrite = school || concern.status !== 'RESOLVED' || concern.canReopen;

  const send = () => {
    const text = body.trim();
    if (!text) return;
    if (!school && concern.status === 'RESOLVED' && concern.canReopen && onReopen) onReopen(text);
    else onComment(text, !privateNote);
    setBody('');
    setPrivateNote(false);
  };

  return (
    <div className="sk-conthread">
      <header className="sk-conthead">
        <div style={{ minWidth: 0 }}>
          <h3>{concern.title}</h3>
          <p className="sk-conmeta">
            {CONCERN_CATEGORY_LABEL[concern.category]} · {concern.student.name}
            {concern.student.className ? ` · ${concern.student.className}` : ''}
            {school ? ` · raised by ${concern.raisedBy.name}` : ''}
            {' · '}
            {concern.audience === 'CLASS_TEACHER' && concern.assignedTeacher
              ? `to ${concern.assignedTeacher.name}`
              : 'to the school office'}
            {concern.escalatedAt ? ' · sent to the office' : ''}
          </p>
        </div>
        <span className="sk-pill" data-tone={CONCERN_STATUS_TONE[concern.status]}>{CONCERN_STATUS_LABEL[concern.status]}</span>
      </header>

      <div className="sk-conbody">{concern.body}</div>

      <ol className="sk-contimeline">
        {concern.comments.map((c) => (
          <li key={c.id} className="sk-conentry" data-private={!c.visibleToFamily || undefined} data-status={c.statusTo ? '' : undefined}>
            <div className="sk-conwho">
              <b>{c.author.name}</b>
              <span>{c.author.role === 'ADMIN' ? 'office' : c.author.role === 'TEACHER' ? 'class teacher' : 'family'}</span>
              <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
              {!c.visibleToFamily && (
                <span className="sk-conprivate"><EyeOff size={11} aria-hidden="true" /> only the school sees this</span>
              )}
            </div>
            {c.statusTo && (
              <p className="sk-constatus">
                {c.statusFrom ? `${CONCERN_STATUS_LABEL[c.statusFrom]} → ` : ''}{CONCERN_STATUS_LABEL[c.statusTo]}
              </p>
            )}
            {c.body ? <p className="sk-context">{c.body}</p> : null}
          </li>
        ))}
        {concern.comments.length === 0 && <li className="sk-state">Nothing said yet.</li>}
      </ol>

      {canWrite && (
        <div className="sk-conreply">
          <label className="sk-sronly" htmlFor="concern-reply">
            {school ? 'Write back to the family' : concern.canReopen ? 'Say why you are reopening this' : 'Add to this concern'}
          </label>
          <textarea
            id="concern-reply"
            className="sk-input"
            rows={3}
            placeholder={school ? 'Write back to the family…' : concern.canReopen ? 'It happened again…' : 'Add something…'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="sk-conactions">
            {school && (
              <label className="sk-conprivtoggle">
                <input type="checkbox" checked={privateNote} onChange={(e) => setPrivateNote(e.target.checked)} />
                <span>Keep this between us</span>
              </label>
            )}
            <span className="sp" style={{ flex: 1 }} />
            <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={busy || !body.trim()} onClick={send}>
              {!school && concern.status === 'RESOLVED' && concern.canReopen
                ? <><Send size={14} aria-hidden="true" /> Reopen</>
                : <><SendHorizonal size={14} aria-hidden="true" /> {privateNote ? 'Add note' : 'Send'}</>}
            </button>
          </div>
        </div>
      )}

      {school && (
        <div className="sk-conmoves">
          {onStatus && concern.status !== 'IN_PROGRESS' && concern.status !== 'RESOLVED' && (
            <button type="button" className="sk-btn sk-press" disabled={busy} onClick={() => onStatus('IN_PROGRESS')}>Looking into it</button>
          )}
          {onStatus && concern.status !== 'RESOLVED' && (
            <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={busy} onClick={() => onStatus('RESOLVED')}>Mark resolved</button>
          )}
          {onStatus && concern.status === 'RESOLVED' && (
            <button type="button" className="sk-btn sk-press" disabled={busy} onClick={() => onStatus('OPEN')}>Open it again</button>
          )}
          {viewer === 'TEACHER' && onEscalate && !concern.escalatedAt && (
            <button type="button" className="sk-btn sk-press" disabled={busy} onClick={onEscalate}>Send to the office</button>
          )}
        </div>
      )}

      {!school && concern.status === 'RESOLVED' && !concern.canReopen && (
        <p className="sk-state" style={{ margin: 0 }}>This one is closed. If it happens again, raise a new concern.</p>
      )}
    </div>
  );
}

/** "Mon 9:12 am" for this week, "21 Sept" beyond it — a family reads a day, not a date stamp. */
function when(iso: string): string {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days < 6
    ? d.toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}
