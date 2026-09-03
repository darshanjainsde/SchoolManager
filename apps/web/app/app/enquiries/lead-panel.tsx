'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import {
  PIPELINE, STAGE_LABEL, dialable, dueLabel, stageTone,
  type EnquiryNote, type EnquiryStage, type Lead,
} from './lead';

interface Detail extends Lead {
  notes: EnquiryNote[];
}

interface StaffMember {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

/**
 * The lead you are working on.
 *
 * Everything the list does not say lives here — the message, the way to reach
 * them, where it has got to, and what was actually said. The list carries who
 * and when and nothing else, so the two halves never state the same fact twice.
 */
export function LeadPanel({ id }: { id: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [lostWhy, setLostWhy] = useState('');
  const [askingWhy, setAskingWhy] = useState(false);

  const detail = useQuery({
    queryKey: ['enquiry', id, host],
    enabled: !!host && !!id,
    queryFn: () => api.get<Detail>(`/site/enquiries/${id}`),
  });

  const staff = useQuery({
    queryKey: ['staff-for-leads', host],
    enabled: !!host,
    queryFn: () => api.get<StaffMember[]>('/manage/staff'),
    staleTime: 5 * 60_000,
  });

  // A different lead is a different form; carrying the half-typed note across
  // would attach it to the wrong family.
  useEffect(() => {
    setNote('');
    setLostWhy('');
    setAskingWhy(false);
  }, [id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['enquiry', id] });
    void qc.invalidateQueries({ queryKey: ['site-enquiries'] });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/site/enquiries/${id}`, body),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: (body: string) => api.post(`/site/enquiries/${id}/notes`, { body }),
    onSuccess: () => {
      setNote('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) return <p className="sk-state">Opening the lead…</p>;
  if (detail.error || !detail.data) {
    return <p className="sk-state err">{(detail.error as Error)?.message ?? 'That enquiry could not be found.'}</p>;
  }

  const l = detail.data;
  const tel = dialable(l.phone);
  const due = dueLabel(l);
  const here = PIPELINE.findIndex((s) => s.key === l.status);
  const lost = l.status === 'LOST' || l.status === 'CLOSED';

  function moveTo(stage: EnquiryStage) {
    if (stage === 'LOST') {
      setAskingWhy(true);
      return;
    }
    patch.mutate({ status: stage });
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
        {l.message ? <p style={{ fontSize: 13.5, color: 'var(--sk-ink-2)' }}>{l.message}</p> : null}

        {/* The number was text you had to select and copy. On a desk that lives
            on the phone, that was the biggest friction on the page. */}
        <div className="sk-enq-contact">
          <a className="sk-btn" data-variant="primary" href={`tel:${tel}`}>Call {l.phone}</a>
          <a className="sk-btn" href={`https://wa.me/${tel.replace(/^\+/, '')}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          {l.email ? (
            <a className="sk-btn" href={`mailto:${l.email}`}>Email</a>
          ) : (
            <span className="sk-btn" aria-disabled="true" style={{ color: 'var(--sk-ink-3)', cursor: 'not-allowed' }}>
              No email given
            </span>
          )}
        </div>

        <div>
          <p className="sk-lab" style={{ marginBottom: 5 }}>Where it has got to</p>
          <div className="sk-enq-stages" role="group" aria-label="Admissions stage">
            {PIPELINE.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className="sk-enq-stage"
                data-state={lost ? undefined : i < here ? 'done' : i === here ? 'now' : undefined}
                aria-pressed={!lost && i === here}
                disabled={patch.isPending}
                onClick={() => moveTo(s.key)}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              className="sk-enq-stage"
              data-state={lost ? 'lost' : undefined}
              aria-pressed={lost}
              disabled={patch.isPending}
              onClick={() => moveTo('LOST')}
            >
              Lost
            </button>
          </div>
          {lost && l.lostReason ? (
            <p className="sk-muted" style={{ fontSize: 11.5, marginTop: 5 }}>Reason: {l.lostReason}</p>
          ) : null}

          {askingWhy ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className="sk-input"
                style={{ flex: '1 1 180px' }}
                value={lostWhy}
                onChange={(e) => setLostWhy(e.target.value)}
                placeholder="Why did it not go ahead?"
                aria-label="Why the lead was lost"
              />
              <button
                className="sk-btn"
                data-variant="primary"
                type="button"
                onClick={() => {
                  patch.mutate({ status: 'LOST', lostReason: lostWhy.trim() || null });
                  setAskingWhy(false);
                }}
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
              {(staff.data ?? [])
                .filter((s) => s.userId)
                .map((s) => (
                  <option key={s.id} value={s.userId as string}>
                    {s.firstName} {s.lastName}
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
                if (e.key === 'Enter' && note.trim()) addNote.mutate(note.trim());
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
