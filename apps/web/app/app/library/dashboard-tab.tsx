'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { sectionHref } from './nav-items';
import {
  Card,
  CardBody,
  CardHead,
  DuePill,
  EmptyRow,
  ListRow,
  Pill,
  StatCard,
  rupees,
  type DashboardPayload,
} from './ui';

/**
 * The library at a glance. Every figure is a door: pressing one either opens
 * another section or drops its own list open underneath.
 */
export default function DashboardTab({ base }: { base: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const router = useRouter();
  const [drill, setDrill] = useState<'out' | 'soon' | null>(null);

  const dash = useQuery({
    queryKey: ['library-dashboard', host],
    enabled: !!host,
    queryFn: () => api.get<DashboardPayload>('/library/dashboard'),
  });

  if (dash.isLoading || !dash.data) {
    return <p className="sk-state">Opening the register…</p>;
  }
  const { counts, outNow, dueSoon, today } = dash.data;

  const drillRows = drill === 'out' ? outNow : drill === 'soon' ? dueSoon : [];
  const drillTitle =
    drill === 'out'
      ? `Out right now · ${counts.outNow}`
      : `Due in the next 7 days · ${counts.dueSoon}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <StatCard
          label="Copies"
          value={counts.totalCopies.toLocaleString('en-IN')}
          detail={`${counts.totalTitles} titles${counts.lostCopies ? ` · ${counts.lostCopies} lost` : ''}`}
          onClick={() => router.push(sectionHref(base, 'books'))}
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
          onClick={() => router.push(sectionHref(base, 'fines'))}
        />
        <StatCard
          label="Fines due"
          value={rupees(counts.finesDueRupees)}
          detail="open the fines tab"
          tone="bad"
          onClick={() => router.push(sectionHref(base, 'fines'))}
        />
      </div>

      {drill ? (
        <Card>
          <CardHead>
            <h3>{drillTitle}</h3>
            <span className="sp" />
            <span className="sk-muted">Press the tile again to close</span>
          </CardHead>
          <CardBody>
            {drillRows.length ? (
              drillRows.map((i) => (
                <ListRow
                  key={i.id}
                  primary={
                    <>
                      {i.title} <span style={{ fontWeight: 400, color: 'var(--sk-ink-3)' }}>— {i.author}</span>
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
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
