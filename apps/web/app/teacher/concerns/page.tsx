'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL, CONCERN_STATUS_TONE,
  type ConcernCounts, type ConcernDetail, type ConcernRow, type ConcernStatus,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { Cell, Overlay, Row, RowList, RowTitle, ScrollBox } from '@/components/ui/kit';
import { ConcernThread } from '@/components/concerns/concern-thread';
import { ago } from '@/lib/concerns';

/**
 * A class teacher's Complaint Box — the same screen as the office's, with one
 * filter fixed by the SERVER: concerns addressed to them, for their sections,
 * nothing else. Nothing here chooses what to show; the query already did.
 */
export default function TeacherConcernsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useQuery({ queryKey: ['t-concern-counts', host], enabled: !!host, queryFn: () => api.get<ConcernCounts>('/teacher/concerns/counts') });
  const list = useQuery({
    queryKey: ['t-concerns', host, showAll], enabled: !!host,
    queryFn: () => api.get<ConcernRow[]>(`/teacher/concerns${showAll ? '' : '?status=OPEN'}`),
  });
  const detail = useQuery({ queryKey: ['t-concern', host, openId], enabled: !!host && !!openId, queryFn: () => api.get<ConcernDetail>(`/teacher/concerns/${openId}`) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['t-concerns'] });
    void qc.invalidateQueries({ queryKey: ['t-concern-counts'] });
    void qc.invalidateQueries({ queryKey: ['t-concern', host, openId] });
  };
  const comment = useMutation({
    mutationFn: ({ body, visibleToFamily }: { body: string; visibleToFamily: boolean }) => api.post<ConcernDetail>(`/teacher/concerns/${openId}/comment`, { body, visibleToFamily }),
    onSuccess: () => { refresh(); toast.success('Sent.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: (status: ConcernStatus) => api.post<ConcernDetail>(`/teacher/concerns/${openId}/status`, { status }),
    onSuccess: () => { refresh(); toast.success('Updated.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const escalate = useMutation({
    mutationFn: () => api.post<ConcernDetail>(`/teacher/concerns/${openId}/escalate`, {}),
    onSuccess: () => { refresh(); toast.success('Sent to the office — you still have it too.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data ?? [];
  const c = counts.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="sk-pagehead">
        <div>
          <h1>Complaint Box</h1>
          <p>What the families of your class raised with you. Opening one marks it read; you can answer, or send it to the office.</p>
        </div>
      </header>

      {c && (
        <div className="sk-kpis">
          <div className="sk-kpi" data-tone={c.unread ? 'warn' : undefined}>
            <div className="lab">Unread</div><div className="n">{c.unread}</div>
            <div className="hint">{c.unread ? 'a family is waiting' : 'nothing waiting on you'}</div>
          </div>
          <div className="sk-kpi"><div className="lab">Open</div><div className="n">{c.open}</div><div className="hint">with you</div></div>
          <div className="sk-kpi" data-tone={c.resolvedThisMonth ? 'good' : undefined}>
            <div className="lab">Resolved this month</div><div className="n">{c.resolvedThisMonth}</div>
            <div className="hint">{c.medianDaysToResolve !== null ? `usually in ${c.medianDaysToResolve} ${c.medianDaysToResolve === 1 ? 'day' : 'days'}` : 'nothing resolved yet'}</div>
          </div>
        </div>
      )}

      <section className="sk-card">
        <div className="sk-card-h sk-hublist-h">
          <h3>{showAll ? 'Everything' : 'Open'}</h3>
          <div className="sk-hubchips" role="group" aria-label="Show">
            <button type="button" className="sk-hubchip" aria-pressed={!showAll} onClick={() => setShowAll(false)}>Open</button>
            <button type="button" className="sk-hubchip" aria-pressed={showAll} onClick={() => setShowAll(true)}>All</button>
          </div>
        </div>
        <div className="sk-card-b">
          {list.isLoading && <p className="sk-state" style={{ margin: 0 }}>Opening the box…</p>}
          {list.isError && <p className="sk-state err" style={{ margin: 0 }}>That could not load. Refresh to try again.</p>}
          {list.data && rows.length === 0 && (
            <p className="sk-state" style={{ margin: 0 }}>
              {showAll ? 'Nothing has been raised with you yet.' : 'Nothing open. A family of your class can write to you from the app.'}
            </p>
          )}
          {rows.length > 0 && (
            <ScrollBox max={480} label={`${rows.length} concerns`}>
              <RowList columns="minmax(0, 1.6fr) auto auto" label="Concerns">
                {rows.map((r) => (
                  <Row key={r.id} onClick={() => setOpenId(r.id)} testId={`t-concern-${r.id}`}>
                    <Cell>
                      <RowTitle
                        title={<>{r.unread && <span className="sk-condot" aria-label="unread" />}{r.title}</>}
                        sub={`${CONCERN_CATEGORY_LABEL[r.category]} · ${r.student.name}${r.student.className ? ` · ${r.student.className}` : ''}`}
                      />
                    </Cell>
                    <Cell align="end"><span className="sk-pill" data-tone={CONCERN_STATUS_TONE[r.status]}>{CONCERN_STATUS_LABEL[r.status]}</span></Cell>
                    <Cell align="end"><span className="sk-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{ago(r.lastActivityAt)}</span></Cell>
                  </Row>
                ))}
              </RowList>
            </ScrollBox>
          )}
        </div>
      </section>

      {hydrated && openId && (
        <Overlay title="Concern" subtitle={detail.data?.student.name} onClose={() => setOpenId(null)}>
          {detail.isLoading && <p className="sk-state">Opening…</p>}
          {detail.isError && <p className="sk-state err">That concern could not load.</p>}
          {detail.data && (
            <ConcernThread
              concern={detail.data}
              viewer="TEACHER"
              busy={comment.isPending || setStatus.isPending || escalate.isPending}
              onComment={(body, visibleToFamily) => comment.mutate({ body, visibleToFamily })}
              onStatus={(s) => setStatus.mutate(s)}
              onEscalate={() => escalate.mutate()}
            />
          )}
        </Overlay>
      )}
    </div>
  );
}
