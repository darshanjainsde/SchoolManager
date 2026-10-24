'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LifeBuoy } from 'lucide-react';
import {
  SUPPORT_MODULE_LABEL, SUPPORT_SEVERITY_LABEL, SUPPORT_STATUS_LABEL_SCHOOL, SUPPORT_STATUS_TONE,
  type SupportFileLink, type SupportSchoolCounts, type SupportTicketDetail, type SupportTicketRow,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { HubKpi, HubKpis, HubPage } from '@/components/ui/hub';
import { Cell, Overlay, Row, RowList, RowTitle, ScrollBox } from '@/components/ui/kit';
import { TicketThread } from '@/components/support/ticket-thread';
import { ReportProblem } from '@/components/support/report-problem';
import { ago } from '@/lib/support';

/**
 * HELP — the school's side of the support desk.
 *
 * Every ticket this school raised with Sckools, newest activity first, with
 * the one state whose next move is theirs ("Waiting on you") in amber. The
 * thread opens in a drawer, never under the list (the kit's rule), and the
 * Report drawer is the same one the sidebar door opens, so the two cannot
 * drift apart.
 */
type Filter = 'OPEN' | 'CLOSED' | 'ALL';
const FILTERS: [Filter, string][] = [['OPEN', 'Open'], ['CLOSED', 'Closed'], ['ALL', 'All']];

export default function SupportPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const counts = useQuery({
    queryKey: ['support-counts', host], enabled: !!host,
    queryFn: () => api.get<SupportSchoolCounts>('/manage/support/counts'),
  });
  const list = useQuery({
    queryKey: ['support-tickets', host, filter], enabled: !!host,
    queryFn: () => api.get<SupportTicketRow[]>(`/manage/support?status=${filter}`),
  });
  const detail = useQuery({
    queryKey: ['support-ticket', host, openId], enabled: !!host && !!openId,
    queryFn: () => api.get<SupportTicketDetail>(`/manage/support/${openId}`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['support-tickets'] });
    void qc.invalidateQueries({ queryKey: ['support-counts'] });
    void qc.invalidateQueries({ queryKey: ['support-ticket', host, openId] });
  };
  const fail = (e: Error) => toast.error(e.message);

  const comment = useMutation({
    mutationFn: ({ body, files }: { body: string; files: File[] }) => {
      const fd = new FormData();
      fd.append('body', body);
      for (const f of files) fd.append('files', f, f.name);
      return api.postForm<SupportTicketDetail>(`/manage/support/${openId}/comment`, fd);
    },
    onSuccess: () => { refresh(); toast.success('Sent to Sckools.'); },
    onError: fail,
  });
  const confirm = useMutation({
    mutationFn: () => api.post<SupportTicketDetail>(`/manage/support/${openId}/confirm`, {}),
    onSuccess: () => { refresh(); toast.success('Closed. Thanks for confirming.'); },
    onError: fail,
  });
  const reopen = useMutation({
    mutationFn: (body: string) => api.post<SupportTicketDetail>(`/manage/support/${openId}/reopen`, { body }),
    onSuccess: () => { refresh(); toast.success('Reopened. Sckools has been told.'); },
    onError: fail,
  });
  const lookIn = useMutation({
    mutationFn: (allow: boolean) => api.post<SupportTicketDetail>(`/manage/support/${openId}/look-in`, { allow }),
    onSuccess: (_d, allow) => { refresh(); toast.success(allow ? 'Sckools may open your console for 48 hours.' : 'Permission withdrawn.'); },
    onError: fail,
  });
  const fileLink = async (key: string) => {
    try {
      const link = await api.get<SupportFileLink>(`/manage/support/${openId}/file?key=${encodeURIComponent(key)}`);
      return link.url;
    } catch (e) { fail(e as Error); throw e; }
  };

  const c = counts.data;
  const rows = list.data ?? [];
  const busy = comment.isPending || confirm.isPending || reopen.isPending || lookIn.isPending;

  return (
    <HubPage
      title="Help"
      subtitle="Your tickets with Sckools. Replies land here and in your email."
      action={
        <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setReporting(true)}>
          <LifeBuoy size={15} aria-hidden="true" /> Report a problem
        </button>
      }
    >
      {counts.isError && <p className="sk-state err">The numbers could not load.</p>}
      {c && (
        <HubKpis>
          <HubKpi label="Open" value={c.open} hint={c.open ? 'with Sckools' : 'nothing open'} />
          <HubKpi label="Waiting on you" value={c.waitingOnYou} hint={c.waitingOnYou ? 'a reply or a confirmation' : 'nothing waiting on you'} tone={c.waitingOnYou ? 'warn' : 'good'} />
          <HubKpi label="Closed" value={c.closed} hint="all time" />
        </HubKpis>
      )}

      <section className="sk-card sk-hublist" aria-label="Tickets">
        <div className="sk-card-h sk-hublist-h">
          <h3>Tickets</h3>
          <div className="sk-hubchips" role="group" aria-label="Show">
            {FILTERS.map(([f, label]) => (
              <button key={f} type="button" className="sk-hubchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="sk-card-b">
          {list.isLoading && <p className="sk-state" style={{ margin: 0 }}>Opening your tickets…</p>}
          {list.isError && (
            <p className="sk-state err" style={{ margin: 0 }}>
              Your tickets could not load.{' '}
              <button type="button" className="sk-btn" data-size="sm" onClick={() => void list.refetch()}>Try again</button>
            </p>
          )}
          {list.data && rows.length === 0 && (
            <p className="sk-state" style={{ margin: 0 }}>
              {filter === 'CLOSED' ? 'Nothing closed yet.'
                : 'Nothing open. When something in Sckools breaks or puzzles you, press Report a problem — from any page.'}
            </p>
          )}
          {rows.length > 0 && (
            <ScrollBox max={520} label={`${rows.length} tickets`}>
              <RowList columns="minmax(0, 1.7fr) 140px auto" label="Tickets">
                {rows.map((r) => (
                  <Row key={r.id} onClick={() => setOpenId(r.id)} testId={`ticket-${r.id}`}>
                    <Cell>
                      <RowTitle
                        title={<><span className="sk-sup-no">{r.ticketNo}</span>{r.title}</>}
                        sub={`${SUPPORT_MODULE_LABEL[r.module]} · ${SUPPORT_SEVERITY_LABEL[r.severity]} · ${r.raisedBy.name}`}
                      />
                    </Cell>
                    <Cell align="end"><span className="sk-pill" data-tone={SUPPORT_STATUS_TONE[r.status]}>{SUPPORT_STATUS_LABEL_SCHOOL[r.status]}</span></Cell>
                    <Cell align="end"><span className="sk-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{ago(r.lastActivityAt)}</span></Cell>
                  </Row>
                ))}
              </RowList>
            </ScrollBox>
          )}
        </div>
      </section>

      {hydrated && openId && (
        <Overlay title="Ticket" subtitle={detail.data?.ticketNo} onClose={() => setOpenId(null)}>
          {detail.isLoading && <p className="sk-state">Opening…</p>}
          {detail.isError && <p className="sk-state err">That ticket could not load.</p>}
          {detail.data && (
            <TicketThread
              ticket={detail.data}
              viewer="SCHOOL"
              busy={busy}
              onComment={(body, files) => comment.mutateAsync({ body, files })}
              onConfirm={() => confirm.mutate()}
              onReopen={(body) => reopen.mutateAsync(body)}
              onLookIn={(allow) => lookIn.mutate(allow)}
              fileLink={fileLink}
            />
          )}
        </Overlay>
      )}

      {hydrated && reporting && (
        <ReportProblem pagePath="/app/support" onClose={() => setReporting(false)} onCreated={(t) => setOpenId(t.id)} />
      )}
    </HubPage>
  );
}
