'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ReturnAction } from './return-action';
import {
  Card,
  CardBody,
  CardHead,
  DuePill,
  EmptyRow,
  ListRow,
  Pill,
  ScanBox,
  todayIso,
  useDebounced,
  type MemberCardView,
  type MemberHit,
  type TitleView,
} from './ui';

type Picked = { kind: 'STUDENT' | 'TEACHER' | 'TITLE'; id: string };

/**
 * The desk's own search, at the top of the dashboard.
 *
 * A librarian standing at the counter almost always starts from a person or a
 * book in front of them, not from a number on a tile. Before this the dashboard
 * could only be read: to act on anything you had to leave for the Counter and
 * search again there. This searches the same two endpoints the Counter does and
 * puts the loans it finds — with their Return — directly under the box.
 *
 * Deliberately does NOT issue. Giving a book out needs a reader AND a title
 * chosen together, plus the limit and duplicate warnings; that is the Counter's
 * job and duplicating it here would be two screens to keep in step.
 */
export function DeskSearch() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const dq = useDebounced(q);
  const searching = dq.trim().length >= 2 && !picked;

  const members = useQuery({
    queryKey: ['library-members', host, dq, 'desk'],
    enabled: !!host && searching,
    queryFn: () => api.get<MemberHit[]>(`/library/members?q=${encodeURIComponent(dq.trim())}`),
  });
  const titles = useQuery({
    queryKey: ['library-titles', host, dq, 'desk'],
    enabled: !!host && searching,
    queryFn: () => api.get<TitleView[]>(`/library/titles?q=${encodeURIComponent(dq.trim())}`),
  });
  const memberCard = useQuery({
    queryKey: ['library-member', host, picked?.kind, picked?.id, 'desk'],
    enabled: !!host && !!picked && picked.kind !== 'TITLE',
    queryFn: () =>
      api.get<MemberCardView>(`/library/members/${picked!.kind.toLowerCase()}/${picked!.id}`),
  });
  const titleCard = useQuery({
    queryKey: ['library-title', host, picked?.id, 'desk'],
    enabled: !!host && !!picked && picked.kind === 'TITLE',
    queryFn: () => api.get<TitleView>(`/library/titles/${picked!.id}`),
  });

  function clear() {
    setPicked(null);
    setQ('');
  }

  const nothingFound =
    searching && members.data && titles.data && !members.data.length && !titles.data.length;

  return (
    <Card>
      <CardHead>
        <h3>At the desk</h3>
        <span className="sp" />
        <span className="sk-muted">Find a reader or a book and take it back from here</span>
      </CardHead>
      <CardBody>
        <ScanBox
          value={q}
          onChange={(v) => { setQ(v); setPicked(null); }}
          placeholder="Student ID, name, book title or accession number…"
          label="Search the library"
        />

        {nothingFound ? <EmptyRow>Nothing matches “{dq.trim()}” — no reader and no title.</EmptyRow> : null}

        {searching && members.data?.length ? (
          <div>
            <p className="sk-lab" style={{ marginBottom: 4 }}>Readers</p>
            {members.data.map((m) => (
              <ListRow
                key={`${m.kind}-${m.id}`}
                primary={m.name}
                secondary={`${m.code ?? 'Teacher'}${m.className ? ` · ${m.className}` : ''}`}
              >
                <Pill tone={m.holding ? 'brand' : 'muted'}>holding {m.holding}</Pill>
                <button
                  className="sk-btn"
                  data-size="sm"
                  type="button"
                  onClick={() => setPicked({ kind: m.kind, id: m.id })}
                >
                  Open
                </button>
              </ListRow>
            ))}
          </div>
        ) : null}

        {searching && titles.data?.length ? (
          <div>
            <p className="sk-lab" style={{ marginBottom: 4 }}>Books</p>
            {titles.data.map((t) => (
              <ListRow key={t.id} primary={t.title} secondary={`${t.author} · shelf ${t.shelf ?? '—'}`}>
                <Pill tone={t.inCopies ? 'good' : 'bad'}>
                  {t.inCopies} of {t.totalCopies} in
                </Pill>
                <button
                  className="sk-btn"
                  data-size="sm"
                  type="button"
                  onClick={() => setPicked({ kind: 'TITLE', id: t.id })}
                >
                  Open
                </button>
              </ListRow>
            ))}
          </div>
        ) : null}

        {picked && picked.kind !== 'TITLE' && memberCard.data ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <p className="sk-lab" style={{ margin: 0 }}>
                {memberCard.data.borrower.name} · holding {memberCard.data.holdings.length} of {memberCard.data.limit}
              </p>
              {memberCard.data.duesRupees > 0 ? <Pill tone="bad">owes ₹{memberCard.data.duesRupees}</Pill> : null}
              <span className="sp" style={{ flex: 1 }} />
              <button className="sk-btn" data-size="sm" type="button" onClick={clear}>
                Clear
              </button>
            </div>
            {memberCard.data.holdings.length ? (
              memberCard.data.holdings.map((h) => (
                <ListRow key={h.id} primary={h.title} secondary={`${h.accessionNo} · ${h.author}`}>
                  <DuePill dueOn={h.dueOn} today={todayIso()} />
                  <ReturnAction issueId={h.id} />
                </ListRow>
              ))
            ) : (
              <EmptyRow>Holding nothing at the moment.</EmptyRow>
            )}
          </div>
        ) : null}

        {picked && picked.kind === 'TITLE' && titleCard.data ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <p className="sk-lab" style={{ margin: 0 }}>
                {titleCard.data.title} · {titleCard.data.inCopies} of {titleCard.data.totalCopies} on the shelf
              </p>
              <span className="sp" style={{ flex: 1 }} />
              <button className="sk-btn" data-size="sm" type="button" onClick={clear}>
                Clear
              </button>
            </div>
            {titleCard.data.copies.filter((c) => c.status === 'OUT').length ? (
              titleCard.data.copies
                .filter((c) => c.status === 'OUT')
                .map((c) => (
                  <ListRow
                    key={c.id}
                    primary={c.accessionNo}
                    secondary={`${c.borrower?.name ?? 'out'}${c.borrower?.code ? ` · ${c.borrower.code}` : ''}`}
                  >
                    {c.dueOn ? <DuePill dueOn={c.dueOn} today={todayIso()} /> : null}
                    {c.issueId ? <ReturnAction issueId={c.issueId} /> : null}
                  </ListRow>
                ))
            ) : (
              <EmptyRow>Every copy of this one is on the shelf.</EmptyRow>
            )}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
