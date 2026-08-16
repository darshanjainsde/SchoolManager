'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import {
  Card,
  DuePill,
  EmptyRow,
  ListRow,
  Pill,
  StatCard,
  rupees,
  type DashboardPayload,
} from './ui';

type Drill = 'out' | 'soon' | null;

export default function LibraryDashboardPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const router = useRouter();
  const [drill, setDrill] = useState<Drill>(null);

  const dash = useQuery({
    queryKey: ['library-dashboard', host],
    enabled: !!host,
    queryFn: () => api.get<DashboardPayload>('/library/dashboard'),
    staleTime: 30_000,
  });

  if (dash.isLoading || !dash.data) {
    return <p className="py-10 text-center text-sm text-[var(--sk-ink-3)]">Opening the library…</p>;
  }
  const { counts, outNow, dueSoon, today } = dash.data;

  const drillRows = drill === 'out' ? outNow : drill === 'soon' ? dueSoon : [];
  const drillTitle =
    drill === 'out'
      ? `Out right now · ${counts.outNow}`
      : `Due in the next 7 days · ${counts.dueSoon}`;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h1 className="font-serif text-xl font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>
          Dashboard
        </h1>
        <span className="text-xs text-[var(--sk-ink-3)]">Click any number to open its list</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Books"
          value={counts.totalCopies.toLocaleString('en-IN')}
          detail={`${counts.totalTitles} titles${counts.lostCopies ? ` · ${counts.lostCopies} lost` : ''}`}
          onClick={() => router.push('/library/books')}
        />
        <StatCard
          label="Out now"
          value={String(counts.outNow)}
          detail="with readers"
          onClick={() => setDrill(drill === 'out' ? null : 'out')}
          active={drill === 'out'}
        />
        <StatCard
          label="Due soon"
          value={String(counts.dueSoon)}
          detail="next 7 days"
          tone="amber"
          onClick={() => setDrill(drill === 'soon' ? null : 'soon')}
          active={drill === 'soon'}
        />
        <StatCard
          label="Fines collected"
          value={rupees(counts.finesCollectedRupees)}
          detail="this term"
          tone="good"
          onClick={() => router.push('/library/fines')}
        />
        <StatCard
          label="Fines due"
          value={rupees(counts.finesDueRupees)}
          detail="open the fines tab"
          tone="bad"
          onClick={() => router.push('/library/fines')}
        />
      </div>

      {drill ? (
        <Card className="mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--sk-line)] bg-[var(--sk-bg-2)] px-4 py-2 text-xs font-bold">
            {drillTitle}
            <span className="font-normal text-[var(--sk-ink-3)]">click the card again to close</span>
          </div>
          {drillRows.length ? (
            drillRows.map((i) => (
              <ListRow
                key={i.id}
                primary={
                  <>
                    {i.title} <span className="font-normal text-[var(--sk-ink-3)]">— {i.author}</span>
                  </>
                }
                secondary={`${i.accessionNo} · ${i.borrower.name}${i.borrower.code ? ` · ${i.borrower.code}` : ''}${i.borrower.className ? ` · ${i.borrower.className}` : ''}`}
              >
                <DuePill dueOn={i.dueOn} today={today} />
                {i.accruedFineRupees > 0 ? <Pill tone="bad">{rupees(i.accruedFineRupees)} so far</Pill> : null}
              </ListRow>
            ))
          ) : (
            <EmptyRow>{drill === 'out' ? 'Every book is home.' : 'Nothing due this week.'}</EmptyRow>
          )}
        </Card>
      ) : null}
    </div>
  );
}
