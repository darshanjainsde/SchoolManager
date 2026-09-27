'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CONCERN_CATEGORIES, CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL, CONCERN_STATUS_TONE,
  type ConcernCounts, type ConcernDetail, type ConcernRow, type ConcernStatus,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { HubKpi, HubKpis, HubPage } from '@/components/ui/hub';
import { Cell, Overlay, Row, RowList, RowTitle, ScrollBox } from '@/components/ui/kit';
import { ConcernThread } from '@/components/concerns/concern-thread';
import { ago } from '@/lib/concerns';

/**
 * THE COMPLAINT BOX — the office's side.
 *
 * Unread first, because the only time-bound thing here is a family waiting.
 * Opening one marks it read (the API does it on the read, so nobody has to
 * press "mark as read"), and the thread opens in a drawer rather than under
 * the list — a 40-row list would put it below the fold, which is the defect
 * the kit's Overlay exists to prevent.
 */
type Filter = 'UNREAD' | 'OPEN' | 'TEACHERS' | 'RESOLVED' | 'ALL';

const FILTERS: [Filter, string][] = [
  ['UNREAD', 'Unread'], ['OPEN', 'Open'], ['TEACHERS', 'With class teachers'], ['RESOLVED', 'Resolved'], ['ALL', 'All'],
];

export default function ConcernsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const [filter, setFilter] = useState<Filter>('UNREAD');
  const [category, setCategory] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const query = new URLSearchParams();
  if (filter === 'UNREAD') query.set('unread', '1');
  if (filter === 'OPEN') query.set('status', 'OPEN');
  if (filter === 'RESOLVED') query.set('status', 'RESOLVED');
  if (category) query.set('category', category);

  const counts = useQuery({
    queryKey: ['concern-counts', host], enabled: !!host,
    queryFn: () => api.get<ConcernCounts>('/manage/concerns/counts'),
  });
  const list = useQuery({
    queryKey: ['concerns', host, filter, category], enabled: !!host,
    queryFn: () => api.get<ConcernRow[]>(`/manage/concerns?${query.toString()}`),
  });
  const detail = useQuery({
    queryKey: ['concern', host, openId], enabled: !!host && !!openId,
    queryFn: () => api.get<ConcernDetail>(`/manage/concerns/${openId}`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['concerns'] });
    void qc.invalidateQueries({ queryKey: ['concern-counts'] });
    void qc.invalidateQueries({ queryKey: ['concern', host, openId] });
  };
  const comment = useMutation({
    mutationFn: ({ body, visibleToFamily }: { body: string; visibleToFamily: boolean }) =>
      api.post<ConcernDetail>(`/manage/concerns/${openId}/comment`, { body, visibleToFamily }),
    onSuccess: () => { refresh(); toast.success('Sent.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: (status: ConcernStatus) => api.post<ConcernDetail>(`/manage/concerns/${openId}/status`, { status }),
    onSuccess: (_d, status) => { refresh(); toast.success(status === 'RESOLVED' ? 'Marked resolved — the family has been told.' : 'Updated.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const c = counts.data;
  const rows = (list.data ?? []).filter((r) => (filter === 'TEACHERS' ? r.audience === 'CLASS_TEACHER' : true));

  return (
    <HubPage
      title="Complaint Box"
      subtitle="What families raised, who it went to, and what was said back. Opening one marks it read."
    >
      {counts.isError && <p className="sk-state err">The numbers could not load.</p>}
      {c && (
        <HubKpis>
          <HubKpi label="Unread" value={c.unread} hint={c.unread ? 'families are waiting' : 'nothing waiting on you'} tone={c.unread ? 'warn' : 'good'} />
          <HubKpi label="Open" value={c.open} hint={c.withClassTeachers ? `${c.withClassTeachers} with the class teachers` : 'none with a class teacher'} />
          <HubKpi
            label="Resolved this month" value={c.resolvedThisMonth}
            hint={c.medianDaysToResolve !== null ? `usually in ${c.medianDaysToResolve} ${c.medianDaysToResolve === 1 ? 'day' : 'days'}` : 'nothing resolved yet'}
            tone={c.resolvedThisMonth ? 'good' : undefined}
          />
          <HubKpi label="Most raised" value={c.topCategory ? CONCERN_CATEGORY_LABEL[c.topCategory] : '—'} hint="this month" />
        </HubKpis>
      )}

      <section className="sk-card sk-hublist" aria-label="Concerns">
        <div className="sk-card-h sk-hublist-h">
          <h3>Concerns</h3>
          <div className="sk-hubchips" role="group" aria-label="Show">
            {FILTERS.map(([f, label]) => (
              <button key={f} type="button" className="sk-hubchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'UNREAD' && c?.unread ? `${label} · ${c.unread}` : label}
              </button>
            ))}
          </div>
        </div>
        <div className="sk-card-b">
          <div className="sk-toolbar" style={{ marginBottom: 4 }}>
            <label className="sk-sronly" htmlFor="concern-category">About</label>
            <select id="concern-category" className="sk-input sk-toolbar-pick" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Anything</option>
              {CONCERN_CATEGORIES.map((k) => <option key={k} value={k}>{CONCERN_CATEGORY_LABEL[k]}</option>)}
            </select>
            <span className="count">{rows.length} {rows.length === 1 ? 'concern' : 'concerns'}</span>
          </div>

          {list.isLoading && <p className="sk-state" style={{ margin: 0 }}>Opening the box…</p>}
          {list.isError && <p className="sk-state err" style={{ margin: 0 }}>The list could not load. Refresh to try again.</p>}
          {list.data && rows.length === 0 && (
            <p className="sk-state" style={{ margin: 0 }}>
              {filter === 'UNREAD' ? 'Nothing unread — every concern has been opened.'
                : filter === 'RESOLVED' ? 'Nothing resolved yet.'
                : 'Nothing here yet. When a family raises a concern from the app or the portal, it lands in this box.'}
            </p>
          )}
          {rows.length > 0 && (
            <ScrollBox max={520} label={`${rows.length} concerns`}>
              <RowList columns="minmax(0, 1.6fr) minmax(0, 1fr) auto auto" label="Concerns">
                {rows.map((r) => (
                  <Row key={r.id} onClick={() => setOpenId(r.id)} testId={`concern-${r.id}`}>
                    <Cell>
                      <RowTitle
                        title={<>{r.unread && <span className="sk-condot" aria-label="unread" />}{r.title}</>}
                        sub={`${CONCERN_CATEGORY_LABEL[r.category]} · ${r.student.name}${r.student.className ? ` · ${r.student.className}` : ''}`}
                      />
                    </Cell>
                    <Cell>
                      <span style={{ fontSize: 12.5, color: 'var(--sk-ink-2)' }}>
                        {r.audience === 'CLASS_TEACHER' && r.assignedTeacher ? `to ${r.assignedTeacher.name}` : 'to the office'}
                        {r.escalatedAt ? ' · sent up' : ''}
                      </span>
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
              viewer="ADMIN"
              busy={comment.isPending || setStatus.isPending}
              onComment={(body, visibleToFamily) => comment.mutate({ body, visibleToFamily })}
              onStatus={(s) => setStatus.mutate(s)}
            />
          )}
        </Overlay>
      )}
    </HubPage>
  );
}
