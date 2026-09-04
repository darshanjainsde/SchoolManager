'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import {
  Card,
  CardBody,
  CardHead,
  EmptyRow,
  ListRow,
  Pill,
  StatCard,
  rupees,
  type FinesPayload,
} from './ui';

/**
 * What is owed, grouped by class so the office can chase a whole section at
 * once. A LATE fine grows while the book is out and settles when it comes
 * back, which is why only FIXED entries carry Collect/Waive.
 */
export default function FinesTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const fines = useQuery({
    queryKey: ['library-fines', host],
    enabled: !!host,
    queryFn: () => api.get<FinesPayload>('/library/fines'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['library-fines'] });
    qc.invalidateQueries({ queryKey: ['library-dashboard'] });
  };

  const settle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'collect' | 'waive' }) =>
      api.post(`/library/fines/${id}/${action}`, {}),
    onSuccess: (_d, vars) => {
      invalidate();
      toast.success(vars.action === 'collect' ? 'Collected' : 'Fine waived', {
        action: {
          label: 'Undo',
          onClick: () =>
            reopen.mutate(vars.id, { onSuccess: () => toast.success('Back on the list') }),
        },
      });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const reopen = useMutation({
    mutationFn: (id: string) => api.post(`/library/fines/${id}/reopen`, {}),
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });
  const remind = useMutation({
    mutationFn: (body: { classSectionId?: string; staff?: boolean }) =>
      api.post<{ readers: number; pushes: number; emails: number }>('/library/fines/remind', body),
    onSuccess: (res) =>
      toast.success(
        res.readers
          ? `Reminder sent — ${res.emails} email${res.emails === 1 ? '' : 's'}, ${res.pushes} app push${res.pushes === 1 ? '' : 'es'}`
          : 'Nobody to remind here',
      ),
    onError: (e) => toast.error((e as Error).message),
  });

  if (fines.isLoading || !fines.data) {
    return <p className="sk-state">Adding up the fines…</p>;
  }
  const d = fines.data;

  // Group by class; teachers under "Staff".
  const groups = new Map<string, { label: string; classSectionId: string | null; staff: boolean; entries: typeof d.entries }>();
  for (const e of d.entries) {
    const key = e.borrower.kind === 'TEACHER' ? 'staff' : (e.borrower.className ?? 'No class');
    const g = groups.get(key) ?? {
      label: e.borrower.kind === 'TEACHER' ? 'Staff' : (e.borrower.className ?? 'No class'),
      classSectionId: e.borrower.classSectionId,
      staff: e.borrower.kind === 'TEACHER',
      entries: [],
    };
    g.entries.push(e);
    groups.set(key, g);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' }}>
        <StatCard label="Collected this term" value={rupees(d.collectedRupees)} tone="good" />
        <StatCard
          label="Still due"
          value={rupees(d.dueRupees)}
          tone="bad"
          detail="a late fine grows while the book is out, and settles at return"
        />
      </div>

      {groups.size === 0 ? (
        <Card>
          <CardBody>
            <EmptyRow>No fines due anywhere — every reader is square with the library.</EmptyRow>
          </CardBody>
        </Card>
      ) : (
        [...groups.values()]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((g) => {
            const total = g.entries.reduce((n, e) => n + e.amountRupees, 0);
            const readers = new Set(g.entries.map((e) => e.borrower.id)).size;
            return (
              <Card key={g.label}>
                <CardHead>
                  <h3>{g.label}</h3>
                  <span className="sk-muted">
                    {readers} reader{readers === 1 ? '' : 's'} · {rupees(total)} due
                  </span>
                  <span className="sp" />
                  <button
                    className="sk-btn"
                    data-size="sm"
                    type="button"
                    onClick={() => remind.mutate(g.staff ? { staff: true } : { classSectionId: g.classSectionId ?? undefined })}
                    disabled={remind.isPending || (!g.staff && !g.classSectionId)}
                  >
                    Remind
                  </button>
                </CardHead>
                <CardBody>
                  {g.entries.map((e) => (
                    <ListRow
                      key={`${e.kind}-${e.id}`}
                      primary={
                        <>
                          {e.borrower.name}{' '}
                          {e.borrower.code ? (
                            <span style={{ fontFamily: 'var(--sk-mono)', fontSize: 11.5, fontWeight: 400, color: 'var(--sk-ink-3)' }}>
                              {e.borrower.code}
                            </span>
                          ) : null}
                        </>
                      }
                      secondary={`${e.title} · ${e.detail}`}
                    >
                      <Pill tone="bad">{rupees(e.amountRupees)}</Pill>
                      {e.kind === 'FIXED' ? (
                        <>
                          <button
                            className="sk-btn"
                            data-size="sm"
                            type="button"
                            onClick={() => settle.mutate({ id: e.id, action: 'waive' })}
                          >
                            Waive
                          </button>
                          <button
                            className="sk-btn"
                            data-size="sm"
                            data-variant="primary"
                            type="button"
                            onClick={() => settle.mutate({ id: e.id, action: 'collect' })}
                          >
                            Collected
                          </button>
                        </>
                      ) : (
                        <Pill tone="muted">settles at return</Pill>
                      )}
                    </ListRow>
                  ))}
                </CardBody>
              </Card>
            );
          })
      )}
    </div>
  );
}
