'use client';
// apps/web/app/app/enquiries/lead-panel.tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactKind, ContactOutcome, EnquiryDeskMember } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import {
  OUTCOMES, STAGE_LABEL, dialable, dueLabel, sourceLabel, stageButtons, stageTone, waNumber,
  type EnquiryNote, type EnquiryStage, type Lead,
} from './lead';

interface Detail extends Lead {
  notes: EnquiryNote[];
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

/** The question the sheet asks, by what was just used. */
const ASK: Record<ContactKind, string> = {
  CALL: 'How did the call go?',
  WHATSAPP: 'How did the WhatsApp go?',
  VISIT: 'How did the visit go?',
};

/**
 * The lead you are working on.
 *
 * Everything the list does not say lives here — the message, the way to reach
 * them, where it has got to, and what was actually said. The list carries who
 * and when and nothing else, so the two halves never state the same fact twice.
 *
 * Call and WhatsApp open the phone AND ask how it went. The answer is what gets
 * logged, in one request, so a call that rang out is recorded as exactly that
 * and never moves a new family to "Contacted".
 */
export function LeadPanel({ id }: { id: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [lostWhy, setLostWhy] = useState('');
  const [askingWhy, setAskingWhy] = useState(false);
  const [contact, setContact] = useState<ContactKind | null>(null);
  const [contactLost, setContactLost] = useState(false);
  const [contactWhy, setContactWhy] = useState('');
  // The API's own words for why a write was refused, shown where the officer is looking.
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['enquiry', id, host],
    enabled: !!host && !!id,
    queryFn: () => api.get<Detail>(`/site/enquiries/${id}`),
  });

  // The desk's own list — works on every plan, unlike /manage/staff.
  const owners = useQuery({
    queryKey: ['enquiry-owners', host],
    enabled: !!host,
    queryFn: () => api.get<EnquiryDeskMember[]>('/site/enquiries/owners'),
    staleTime: 5 * 60_000,
  });

  // A different lead is a different form: the page mounts this with key={id}, so
  // a half-typed note or an open "how did it go?" can never carry across, and a
  // late answer to a write on lead A has no state of B's to land in.

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['enquiry', id] });
    void qc.invalidateQueries({ queryKey: ['site-enquiries'] });
  };

  // Escape puts the question away, wherever focus is — the link that opened it
  // is the thing with focus, not the sheet.
  useEffect(() => {
    if (!contact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContact(null);
        setContactLost(false);
        setContactWhy('');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [contact]);

  const closeSheet = () => {
    setContact(null);
    setContactLost(false);
    setContactWhy('');
  };

  // A write can lose a race to a colleague (409 ENQUIRY_CHANGED), or ask for a
  // stage that is now behind the lead (ENQUIRY_STAGE_BACKWARDS). Say so, and
  // refetch: the stage the officer is looking at is already out of date, and so
  // is any half-answered question built on it.
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : 'That did not save. Check your connection and try again.');
    const code = e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined;
    if (code === 'ENQUIRY_CHANGED' || code === 'ENQUIRY_STAGE_BACKWARDS') {
      setAskingWhy(false);
      setLostWhy('');
      closeSheet();
      refresh();
    }
  };

  // Each write sends only what it changes — never the whole lead.
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/site/enquiries/${id}`, body),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: fail,
  });

  const addNote = useMutation({
    mutationFn: (body: string) => api.post(`/site/enquiries/${id}/notes`, { body }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setNote('');
      refresh();
    },
    onError: fail,
  });

  const log = useMutation({
    mutationFn: (body: { kind: ContactKind; outcome: ContactOutcome; lostReason?: string | null }) =>
      api.post(`/site/enquiries/${id}/notes`, body),
    onMutate: () => setError(null),
    onSuccess: () => {
      closeSheet();
      refresh();
    },
    onError: fail,
  });

  if (detail.isLoading) return <p className="sk-state">Opening the lead…</p>;
  if (detail.error || !detail.data) {
    return <p className="sk-state err">{(detail.error as Error)?.message ?? 'That enquiry could not be found.'}</p>;
  }

  const l = detail.data;
  const tel = dialable(l.phone);
  const wa = waNumber(l.phone);
  const due = dueLabel(l);
  const lost = l.status === 'LOST' || l.status === 'CLOSED';
  const members = owners.data ?? [];
  // An owner who has left the desk is still the owner on the row; without an
  // option for them the select would silently read "Nobody yet".
  const ownerMissing = !!l.ownerUserId && !members.some((m) => m.userId === l.ownerUserId);

  function moveTo(stage: EnquiryStage) {
    if (stage === 'LOST') {
      setAskingWhy(true);
      return;
    }
    patch.mutate({ status: stage });
  }

  function answer(outcome: ContactOutcome) {
    if (!contact) return;
    if (outcome === 'LOST') {
      setContactLost(true);
      return;
    }
    log.mutate({ kind: contact, outcome });
  }

  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>{l.parentName}</h3>
        <span className="sk-pill" data-tone={stageTone(l.status)}>{STAGE_LABEL[l.status]}</span>
        <span className="sp" />
        <span className="sk-muted">{l.gradeInterest ?? 'No class given'}</span>
      </div>

      <div className="sk-card-b">
        {error ? <p className="sk-state err" role="alert">{error}</p> : null}

        <p className="sk-muted" style={{ fontSize: 12 }}>
          {sourceLabel(l)}
          {l.childName ? ` · for ${l.childName}` : ''}
          {' · '}
          {l.lastContactedAt ? `last contacted ${when(l.lastContactedAt)}` : 'not contacted yet'}
          {l.whatsappOk ? ' · happy to get WhatsApp' : ''}
        </p>

        {l.message ? <p style={{ fontSize: 13.5, color: 'var(--sk-ink-2)' }}>{l.message}</p> : null}

        <div className="sk-enq-contact">
          <a className="sk-btn" data-variant="primary" href={`tel:${tel}`} onClick={() => setContact('CALL')}>
            Call <span style={{ whiteSpace: 'nowrap' }}>{l.phone}</span>
          </a>
          {wa ? (
            <a
              className="sk-btn"
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setContact('WHATSAPP')}
            >
              WhatsApp
            </a>
          ) : null}
          {l.email ? (
            <a className="sk-btn" href={`mailto:${l.email}`}>Email</a>
          ) : (
            <span className="sk-btn" aria-disabled="true" style={{ color: 'var(--sk-ink-3)', cursor: 'not-allowed' }}>
              No email given
            </span>
          )}
        </div>

        {contact ? (
          <div className="sk-enq-outcome" role="group" aria-label="How did it go?">
            <p className="sk-lab">{ASK[contact]}</p>
            <div className="opts">
              {OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className="sk-btn"
                  aria-pressed={o.key === 'LOST' ? contactLost : undefined}
                  disabled={log.isPending}
                  onClick={() => answer(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {contactLost ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="sk-input"
                  style={{ flex: '1 1 180px' }}
                  value={contactWhy}
                  onChange={(e) => setContactWhy(e.target.value)}
                  placeholder="Why are they not going ahead?"
                  maxLength={200}
                  aria-label="Why the family is not going ahead"
                />
                <button
                  className="sk-btn"
                  data-variant="primary"
                  type="button"
                  disabled={log.isPending || !contactWhy.trim()}
                  onClick={() => log.mutate({ kind: contact, outcome: 'LOST', lostReason: contactWhy.trim() })}
                >
                  Mark lost
                </button>
              </div>
            ) : null}
            <button type="button" className="sk-btn" style={{ justifySelf: 'start' }} onClick={closeSheet}>
              Not now
            </button>
          </div>
        ) : null}

        <div>
          <p className="sk-lab" style={{ marginBottom: 5 }}>Where it has got to</p>
          <div className="sk-enq-stages" role="group" aria-label="Admissions stage">
            {stageButtons(l.status).map((b) => (
              <button
                key={b.key}
                type="button"
                className="sk-enq-stage"
                data-state={b.state}
                aria-pressed={b.state === 'now'}
                aria-current={b.state === 'now' ? 'step' : undefined}
                aria-label={b.state === 'done' ? `${b.label} — done` : undefined}
                disabled={!b.canClick || patch.isPending}
                onClick={() => moveTo(b.key)}
              >
                {b.label}
              </button>
            ))}
            <button
              type="button"
              className="sk-enq-stage"
              data-state={lost ? 'lost' : undefined}
              aria-pressed={lost}
              disabled={lost || patch.isPending}
              onClick={() => moveTo('LOST')}
            >
              Lost
            </button>
          </div>

          {lost ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              {l.lostReason ? <span className="sk-muted" style={{ fontSize: 11.5 }}>Reason: {l.lostReason}</span> : null}
              <button type="button" className="sk-btn" data-size="sm" disabled={patch.isPending} onClick={() => patch.mutate({ status: 'CONTACTED' })}>
                Reopen
              </button>
            </div>
          ) : null}

          {askingWhy ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className="sk-input"
                style={{ flex: '1 1 180px' }}
                value={lostWhy}
                onChange={(e) => setLostWhy(e.target.value)}
                placeholder="Why did it not go ahead?"
                maxLength={200}
                aria-label="Why the lead was lost"
              />
              <button
                className="sk-btn"
                data-variant="primary"
                type="button"
                disabled={patch.isPending || !lostWhy.trim()}
                // The form closes only when the write lands: a refusal keeps what was typed.
                onClick={() => patch.mutate(
                  { status: 'LOST', lostReason: lostWhy.trim() },
                  { onSuccess: () => { setAskingWhy(false); setLostWhy(''); } },
                )}
              >
                Mark lost
              </button>
              <button className="sk-btn" type="button" onClick={() => setAskingWhy(false)}>Cancel</button>
            </div>
          ) : null}
        </div>

        <div className="sk-enq-fields">
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Ring them again on</span>
            <input
              className="sk-input"
              type="date"
              value={l.followUpAt ? l.followUpAt.slice(0, 10) : ''}
              disabled={lost || l.status === 'ENROLLED'}
              onChange={(e) => patch.mutate({ followUpAt: e.target.value || null })}
            />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Whose lead this is</span>
            <select
              className="sk-input"
              value={l.ownerUserId ?? ''}
              onChange={(e) => patch.mutate({ ownerUserId: e.target.value || null })}
            >
              <option value="">Nobody yet</option>
              {ownerMissing ? (
                <option value={l.ownerUserId as string}>
                  {owners.isSuccess ? `${l.ownerName ?? 'Somebody'} — no longer on the desk` : (l.ownerName ?? '…')}
                </option>
              ) : null}
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} · {m.job === 'ADMISSIONS' ? 'Admissions' : 'Admin'}
                </option>
              ))}
            </select>
          </label>
        </div>

        {due && due.tone !== 'muted' ? (
          <span className="sk-pill" data-tone={due.tone === 'bad' ? 'bad' : 'warn'} style={{ alignSelf: 'flex-start' }}>
            {due.text}
          </span>
        ) : null}

        <div>
          <p className="sk-lab" style={{ marginBottom: 5 }}>What happened</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              className="sk-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && note.trim() && !addNote.isPending) addNote.mutate(note.trim());
              }}
              placeholder="What did they say?"
              aria-label="Add a note"
            />
            <button
              className="sk-btn"
              data-variant="primary"
              type="button"
              disabled={!note.trim() || addNote.isPending}
              onClick={() => addNote.mutate(note.trim())}
            >
              {addNote.isPending ? 'Saving…' : 'Add'}
            </button>
          </div>
          {l.notes.length ? (
            l.notes.map((n) => (
              <div key={n.id} className="sk-enq-tl" data-kind={n.kind}>
                <span className="dot" />
                <span>
                  <span className="body">{n.body}</span>
                  <br />
                  <span className="who">
                    {n.authorName ? `${n.authorName} · ` : ''}
                    {when(n.createdAt)}
                  </span>
                </span>
              </div>
            ))
          ) : (
            <p className="sk-state">Nothing recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
