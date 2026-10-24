'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { SUPPORT_MODULE_LABEL, SUPPORT_SEVERITY_LABEL, SUPPORT_STATUS_LABEL, SUPPORT_STATUS_TONE } from '@skoolos/types';
import type { SupportBoard, SupportTicketRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { MODULE_OPTIONS, TYPE_OPTIONS } from '@/lib/support';
import { STATUS_FILTERS, ageLabel, hoursSince, ticketTone } from './desk';

/**
 * THE SUPPORT TAB — every school's tickets, school-wise, oldest unanswered
 * first.
 *
 * The board answers "who is waiting on me, and for how long" before anything
 * else: one row per school with open tickets, its oldest unanswered ticket and
 * that ticket's age, a red stripe past 24 hours. The list under it is the
 * work queue, narrowed by labelled selects (school, status, type, module), one
 * aligned table, late first. Lateness outranks status in every colour — the
 * same rule the Print Orders queue follows.
 */
export default function SupportPage() {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const [schoolId, setSchoolId] = useState('');
  const [status, setStatus] = useState<string>('');
  const [type, setType] = useState('');
  const [module, setModule] = useState('');

  const board = useQuery({
    queryKey: ['owner-support-board'],
    queryFn: () => api.get<SupportBoard>('/owner/support/board'),
    staleTime: 30_000,
  });

  const qs = new URLSearchParams();
  if (schoolId) qs.set('schoolId', schoolId);
  if (status) qs.set('status', status);
  if (type) qs.set('type', type);
  if (module) qs.set('module', module);
  const list = useQuery({
    queryKey: ['owner-support-tickets', schoolId, status, type, module],
    queryFn: () => api.get<SupportTicketRow[]>(`/owner/support/tickets?${qs.toString()}`),
  });

  const counts = board.data?.counts;
  const rows = list.data ?? [];

  return (
    <>
      <header className="sk-own-head">
        <div>
          <h1>Support</h1>
          <p className="sk-own-sub">Every school&apos;s open tickets. Oldest unanswered first.</p>
        </div>
      </header>

      {!board.data && !board.error && <p className="sk-own-state">Loading the board…</p>}
      {board.error && (
        <p className="sk-own-state" role="alert">
          The board could not load.{' '}
          <button type="button" className="sk-own-link" onClick={() => void board.refetch()}>Try again</button>
        </p>
      )}

      {counts && (
        <div className="sk-own-attention" aria-label="At a glance">
          <button type="button" className="sk-own-attn" data-urgent={counts.pastDay > 0 ? 'true' : undefined} onClick={() => { setStatus(''); setSchoolId(''); }}>
            <span className="n">{counts.unanswered}</span>
            <div style={{ minWidth: 0 }}><div className="t">Unanswered</div><div className="s">the school moved last</div></div>
          </button>
          <button type="button" className="sk-own-attn" data-urgent={counts.pastDay > 0 ? 'true' : undefined} onClick={() => { setStatus(''); setSchoolId(''); }}>
            <span className="n">{counts.pastDay}</span>
            <div style={{ minWidth: 0 }}><div className="t">Past 24 h</div><div className="s">waiting more than a day</div></div>
          </button>
          <button type="button" className="sk-own-attn" onClick={() => setStatus('WAITING_ON_SCHOOL')}>
            <span className="n">{counts.waitingOnSchool}</span>
            <div style={{ minWidth: 0 }}><div className="t">Waiting on school</div><div className="s">their move, not ours</div></div>
          </button>
        </div>
      )}

      {board.data && (
        <section className="sk-own-panel" aria-labelledby="by-school">
          <h2 id="by-school">By school</h2>
          <p>{board.data.schools.length} {board.data.schools.length === 1 ? 'school has' : 'schools have'} open tickets · {counts?.open ?? 0} open in all</p>
          {board.data.schools.length === 0 ? (
            <div className="sk-own-empty">
              <span className="ic"><LifeBuoy size={20} aria-hidden="true" /></span>
              <h4>Nothing open</h4>
              <p>When a school reports a problem from its console, it lands here, newest school at the top of the queue.</p>
            </div>
          ) : (
            <div className="sk-own-tablewrap">
              <table className="sk-own-table" data-testid="support-board">
                <thead>
                  <tr><th>School</th><th>Plan</th><th>Open</th><th>Waiting on school</th><th>Oldest unanswered</th><th aria-label="Actions"></th></tr>
                </thead>
                <tbody>
                  {board.data.schools.map((s) => {
                    const hrs = s.oldestUnansweredAt ? hoursSince(s.oldestUnansweredAt) : null;
                    return (
                      <tr key={s.schoolId} className="sk-sup-row" data-tone={hrs === null ? 'info' : ticketTone('OPEN', hrs)} data-testid={`board-${s.slug}`}>
                        <td><div style={{ minWidth: 0 }}><b>{s.name}</b><div className="sk-own-sub" style={{ fontSize: 11.5 }}>{s.slug}</div></div></td>
                        <td><span className="sk-pill" data-tone="neutral">{s.tier}</span></td>
                        <td className="sk-sup-age">{s.open}</td>
                        <td className="sk-sup-age">{s.waitingOnSchool}</td>
                        <td>
                          {s.oldestUnansweredTitle ? (
                            <div style={{ minWidth: 0, maxWidth: 320 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.oldestUnansweredTitle}</div>
                              <span className="sk-sup-age" data-late={hrs !== null && hrs > 24 ? '' : undefined}>{hrs !== null ? ageLabel(hrs) : ''}</span>
                            </div>
                          ) : <span className="sk-own-sub">all answered</span>}
                        </td>
                        <td><button type="button" className="sk-own-btn" onClick={() => setSchoolId(s.schoolId)}>See tickets</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="sk-own-panel" aria-labelledby="tickets">
        <h2 id="tickets">Tickets</h2>
        <p>Narrow by school, status, kind or module. Each row opens the desk.</p>
        <div className="sk-own-fldgrid" style={{ marginBottom: 12 }}>
          <div className="sk-own-fld">
            <label htmlFor="sup-f-school">School</label>
            <select id="sup-f-school" className="sk-input" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              <option value="">Every school</option>
              {(board.data?.schools ?? []).map((s) => <option key={s.schoolId} value={s.schoolId}>{s.name}</option>)}
            </select>
          </div>
          <div className="sk-own-fld">
            <label htmlFor="sup-f-status">Status</label>
            <select id="sup-f-status" className="sk-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div className="sk-own-fld">
            <label htmlFor="sup-f-type">Kind</label>
            <select id="sup-f-type" className="sk-input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any kind</option>
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="sk-own-fld">
            <label htmlFor="sup-f-module">Module</label>
            <select id="sup-f-module" className="sk-input" value={module} onChange={(e) => setModule(e.target.value)}>
              <option value="">Any module</option>
              {MODULE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {!list.data && !list.error && <p className="sk-own-state">Loading tickets…</p>}
        {list.error && (
          <p className="sk-own-state" role="alert">
            The tickets could not load.{' '}
            <button type="button" className="sk-own-link" onClick={() => void list.refetch()}>Try again</button>
          </p>
        )}
        {list.data && rows.length === 0 && <p className="sk-own-state">Nothing matches. Widen a filter.</p>}
        {rows.length > 0 && (
          <div className="sk-own-tablewrap">
            <table className="sk-own-table" data-testid="support-list">
              <thead>
                <tr><th>Ticket</th><th>School</th><th>Module</th><th>Severity</th><th>Status</th><th>Last activity</th></tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const hrs = t.unanswered ? hoursSince(t.lastSchoolActivityAt) : null;
                  return (
                    <tr key={t.id} className="sk-sup-row" data-tone={ticketTone(t.status, hrs)} data-testid={`ticket-${t.id}`}>
                      <td>
                        <Link href={`/platform/support/${t.id}`} className="sk-own-link" style={{ display: 'block', minWidth: 0, maxWidth: 360 }}>
                          <span className="sk-sup-no">{t.ticketNo}</span>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                        </Link>
                      </td>
                      <td>{t.school?.name ?? '—'}</td>
                      <td>{SUPPORT_MODULE_LABEL[t.module]}</td>
                      <td>{SUPPORT_SEVERITY_LABEL[t.severity]}</td>
                      <td><span className="sk-pill" data-tone={SUPPORT_STATUS_TONE[t.status]}>{SUPPORT_STATUS_LABEL[t.status]}</span></td>
                      <td>
                        <span className="sk-sup-age" data-late={hrs !== null && hrs > 24 ? '' : undefined}>
                          {ageLabel(hoursSince(t.lastActivityAt))}{t.unanswered ? ' · unanswered' : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
