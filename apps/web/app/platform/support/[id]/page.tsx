'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { SUPPORT_STATUS_LABEL, SUPPORT_STATUS_TONE, type SupportFileLink, type SupportStatus, type SupportTicketDetail } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { TicketThread } from '@/components/support/ticket-thread';
import { hoursLeft, when } from '@/lib/support';
import { OWNER_MOVES } from '../desk';

/**
 * ONE TICKET, FROM THE DESK — the thread on the left, the controls on the right.
 *
 * The desk offers only the moves the machine allows from here (the API refuses
 * the rest), a private-note toggle on the composer, "take it", a GitHub
 * reference the school never sees, and "Open as this school" — enabled only
 * while the school's consent clock is running, because a button that always
 * works would be a button that sometimes should not.
 */
export default function SupportTicketPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [move, setMove] = useState<SupportStatus | ''>('');
  const [note, setNote] = useState('');
  const [ref, setRef] = useState<string | null>(null);

  const ticket = useQuery({
    queryKey: ['owner-support-ticket', id],
    queryFn: () => api.get<SupportTicketDetail>(`/owner/support/${id}`),
    enabled: !!id,
  });
  const t = ticket.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['owner-support-ticket', id] });
    void qc.invalidateQueries({ queryKey: ['owner-support-tickets'] });
    void qc.invalidateQueries({ queryKey: ['owner-support-board'] });
    void qc.invalidateQueries({ queryKey: ['owner-support-counts'] });
  };
  const fail = (e: Error) => toast.error(e.message);

  const comment = useMutation({
    mutationFn: ({ body, visibleToSchool }: { body: string; visibleToSchool: boolean }) =>
      api.post<SupportTicketDetail>(`/owner/support/${id}/comment`, { body, visibleToSchool }),
    onSuccess: (_d, v) => { refresh(); toast.success(v.visibleToSchool ? 'Sent — the school sees it on its Help page.' : 'Note kept on the desk.'); },
    onError: fail,
  });
  const status = useMutation({
    mutationFn: (s: SupportStatus) => api.post<SupportTicketDetail>(`/owner/support/${id}/status`, { status: s, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (_d, s) => { refresh(); setMove(''); setNote(''); toast.success(`Now ${SUPPORT_STATUS_LABEL[s].toLowerCase()} — the school has been told.`); },
    onError: fail,
  });
  const assign = useMutation({
    mutationFn: (take: boolean) => api.post<SupportTicketDetail>(`/owner/support/${id}/assign`, { assign: take }),
    onSuccess: refresh,
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: (externalRef: string | null) => api.patch<SupportTicketDetail>(`/owner/support/${id}`, { externalRef }),
    onSuccess: () => { refresh(); setRef(null); toast.success('Reference saved.'); },
    onError: fail,
  });
  const openSchool = useMutation({
    mutationFn: () => api.post<{ url: string; expiresInSeconds: number }>(`/owner/support/${id}/open-school`, {}),
    onSuccess: ({ url }) => { window.open(url, '_blank', 'noopener'); refresh(); toast.success('Opening the school — single-use link, valid 15 minutes. The school sees this on its timeline.'); },
    onError: fail,
  });
  const fileLink = async (key: string) => {
    try {
      const link = await api.get<SupportFileLink>(`/owner/support/${id}/file?key=${encodeURIComponent(key)}`);
      return link.url;
    } catch (e) { fail(e as Error); throw e; }
  };

  const lookIn = t ? hoursLeft(t.lookInUntil) : null;
  const moves = t ? OWNER_MOVES[t.status] : [];
  const busy = comment.isPending || status.isPending || assign.isPending || patch.isPending || openSchool.isPending;

  return (
    <>
      <header className="sk-own-head">
        <div style={{ minWidth: 0 }}>
          <Link href="/platform/support" className="sk-own-link sk-sup-back">
            <ArrowLeft size={14} aria-hidden="true" /> Support
          </Link>
          <h1>{t ? <><span className="sk-sup-no">{t.ticketNo}</span> {t.title}</> : 'Ticket'}</h1>
          {t?.school && <p className="sk-own-sub">{t.school.name} · {t.school.tier} · raised by {t.raisedBy.name} · {when(t.createdAt)}</p>}
        </div>
      </header>

      {!t && !ticket.error && <p className="sk-own-state">Opening the ticket…</p>}
      {ticket.error && (
        <p className="sk-own-state" role="alert">
          That ticket could not load.{' '}
          <button type="button" className="sk-own-link" onClick={() => void ticket.refetch()}>Try again</button>
        </p>
      )}

      {t && (
        <div className="sk-sup-desk">
          <section className="sk-own-panel" aria-label="Timeline">
            <TicketThread
              ticket={t}
              viewer="OWNER"
              busy={busy}
              onComment={(body, _files, visibleToSchool) => comment.mutate({ body, visibleToSchool })}
              fileLink={fileLink}
            />
          </section>

          <aside className="sk-own-panel" aria-label="Desk">
            <h2>Desk</h2>
            <div className="sk-sup-kv">
              <span>Status</span>
              <span><span className="sk-pill" data-tone={SUPPORT_STATUS_TONE[t.status]}>{SUPPORT_STATUS_LABEL[t.status]}</span></span>

              <span>Move to</span>
              <span>
                {moves.length === 0 ? (
                  <span className="sk-own-sub">Closed. Only the school can reopen it.</span>
                ) : (
                  <div className="sk-own-fld">
                    <label htmlFor="sup-move">Move to</label>
                    <select id="sup-move" className="sk-input" value={move} onChange={(e) => setMove(e.target.value as SupportStatus | '')}>
                      <option value="">Choose a move…</option>
                      {moves.map((m) => <option key={m} value={m}>{SUPPORT_STATUS_LABEL[m]}</option>)}
                    </select>
                    <label htmlFor="sup-move-note">Note to the school</label>
                    <input id="sup-move-note" className="sk-input" placeholder="A line the school reads with the move (optional)" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
                    <button type="button" className="sk-own-btn" data-kind="primary" disabled={!move || busy} onClick={() => move && status.mutate(move)}>Move</button>
                  </div>
                )}
              </span>

              <span>Assigned</span>
              <span>
                {t.assignedTo ? t.assignedTo.name : <span className="sk-own-sub">Nobody yet</span>}{' '}
                <button type="button" className="sk-own-btn" disabled={busy} onClick={() => assign.mutate(!t.assignedTo)}>{t.assignedTo ? 'Hand back' : 'Take it'}</button>
              </span>

              <span>Look-in</span>
              <span>
                {lookIn
                  ? <span className="sk-pill" data-tone="good">Allowed · {lookIn}</span>
                  : <span className="sk-pill" data-tone="neutral">Not allowed</span>}
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button" className="sk-own-btn" data-kind="primary" disabled={!lookIn || busy}
                    title={lookIn ? undefined : 'The school has not allowed Sckools to open its console for this ticket.'}
                    onClick={() => openSchool.mutate()}
                  >
                    <ExternalLink size={13} aria-hidden="true" /> Open as this school
                  </button>
                </div>
              </span>

              <span>Reference</span>
              <span>
                <div className="sk-own-fld">
                  <label htmlFor="sup-ref">GitHub or other reference</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input id="sup-ref" className="sk-input" placeholder="#412" maxLength={120} value={ref ?? t.externalRef ?? ''} onChange={(e) => setRef(e.target.value)} style={{ minWidth: 0 }} />
                  <button type="button" className="sk-own-btn" disabled={ref === null || busy} onClick={() => patch.mutate(ref && ref.trim() ? ref.trim() : null)}>Save</button>
                  </div>
                </div>
                <span className="sk-own-sub" style={{ fontSize: 11.5 }}>The school never sees this.</span>
              </span>

              <span>Same module</span>
              <span>{t.sameModuleOpen === 0 ? <span className="sk-own-sub">No other school this week</span> : `${t.sameModuleOpen} other ${t.sameModuleOpen === 1 ? 'school has' : 'schools have'} an open ticket here this week`}</span>

              {t.school && (<>
                <span>School</span>
                <span><Link href={`/platform/schools/${t.school.id}`} className="sk-own-link">{t.school.name}</Link> · {t.school.slug}</span>
              </>)}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
