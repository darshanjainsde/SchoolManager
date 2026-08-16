'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, EmptyRow, ListRow, Pill, StatCard, rupees, type FinesPayload } from './../ui';

export default function LibraryFinesPage() {
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
    return <p className="py-10 text-center text-sm text-[var(--sk-ink-3)]">Adding up the fines…</p>;
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
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h1 className="font-serif text-xl font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>
          Fines
        </h1>
        <span className="text-xs text-[var(--sk-ink-3)]">a fine grows while the book is out, and settles at return</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <StatCard label="Collected this term" value={rupees(d.collectedRupees)} tone="good" />
        <StatCard label="Still due" value={rupees(d.dueRupees)} tone="bad" />
      </div>

      {groups.size === 0 ? (
        <Card className="mt-4"><EmptyRow>No fines due anywhere. 🎉</EmptyRow></Card>
      ) : (
        [...groups.values()]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((g) => {
            const total = g.entries.reduce((n, e) => n + e.amountRupees, 0);
            const readers = new Set(g.entries.map((e) => e.borrower.id)).size;
            return (
              <Card key={g.label} className="mt-4 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--sk-line)] bg-[var(--sk-bg-2)] px-3 py-2 text-xs font-bold">
                  <span className="rounded bg-[var(--sk-brand-tint)] px-2 py-0.5 font-mono text-[11px] text-[var(--sk-brand-2)]">
                    {g.label}
                  </span>
                  {readers} reader{readers === 1 ? '' : 's'}
                  <span className="ml-auto tabular-nums text-[var(--sk-bad)]">{rupees(total)} due</span>
                  <span className="flex gap-1.5">
                    <button
                      className="rounded-lg border border-[var(--sk-line)] bg-[var(--sk-card)] px-2.5 py-1 font-bold text-[var(--sk-ink-2)]"
                      onClick={() => remind.mutate(g.staff ? { staff: true } : { classSectionId: g.classSectionId ?? undefined })}
                      disabled={remind.isPending || (!g.staff && !g.classSectionId)}
                    >
                      ✉️🔔 Remind
                    </button>
                  </span>
                </div>
                {g.entries.map((e) => (
                  <ListRow
                    key={`${e.kind}-${e.id}`}
                    primary={
                      <>
                        {e.borrower.name}{' '}
                        {e.borrower.code ? <span className="font-mono text-xs font-normal text-[var(--sk-ink-3)]">{e.borrower.code}</span> : null}
                      </>
                    }
                    secondary={`${e.title} · ${e.detail}`}
                  >
                    <Pill tone="bad">{rupees(e.amountRupees)}</Pill>
                    {e.kind === 'FIXED' ? (
                      <>
                        <button
                          className="rounded-full bg-[var(--sk-good-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-good)]"
                          onClick={() => settle.mutate({ id: e.id, action: 'collect' })}
                        >
                          Collected
                        </button>
                        <button
                          className="rounded-full bg-[var(--sk-bg-2)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-ink-3)]"
                          onClick={() => settle.mutate({ id: e.id, action: 'waive' })}
                        >
                          Waive
                        </button>
                      </>
                    ) : (
                      <Pill tone="muted">settles at return</Pill>
                    )}
                  </ListRow>
                ))}
              </Card>
            );
          })
      )}
    </div>
  );
}
