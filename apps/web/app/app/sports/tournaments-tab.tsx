'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardBody, CardHead, EmptyRow, ListRow, Pill, STATUS_LABEL, TONE, fmtDay, useDesk, type TournamentRow } from './ui';
import Wizard from './wizard';

/** The meets: live ones first, then drafts, then history. "New tournament" opens the wizard in place. */
export default function TournamentsTab({ base }: { base: string }) {
  const { api, host, can, ready } = useDesk();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['sports-tournaments', host], enabled: !!host, queryFn: () => api.get<TournamentRow[]>('/sports/tournaments') });

  const rows = list.data ?? [];
  const order = { LIVE: 0, DRAFT: 1, DONE: 2 } as const;
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status] || b.startsOn.localeCompare(a.startsOn));

  return (
    <div className="sk-sp-stack">
      {creating ? <Wizard base={base} onClose={() => setCreating(false)} /> : null}
      <Card>
        <CardHead>
          <h3>Tournaments</h3>
          <span className="sp" />
          {ready && can('CREATE') && !creating ? (
            <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setCreating(true)}>New tournament</button>
          ) : null}
        </CardHead>
        <CardBody>
          {list.isLoading ? <EmptyRow>Opening the desk…</EmptyRow> : null}
          {!list.isLoading && sorted.length === 0 ? (
            <EmptyRow>No tournament yet. New tournament takes five minutes: name it, add the venues, press the sports, pick the players — the draws and the day board build themselves.</EmptyRow>
          ) : null}
          {sorted.map((t) => (
            <ListRow
              key={t.id}
              primary={<Link href={`${base}/tournaments/${t.id}`}>{t.name}</Link>}
              secondary={`${fmtDay(t.startsOn)}${t.endsOn !== t.startsOn ? ` – ${fmtDay(t.endsOn)}` : ''} · ${t.events} event${t.events === 1 ? '' : 's'}`}
            >
              <Pill tone={TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
              {t.status === 'DRAFT' ? <Pill tone="amber">Not visible to students</Pill> : null}
              <Link className="sk-btn" data-size="sm" href={`${base}/tournaments/${t.id}`}>Open</Link>
            </ListRow>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
