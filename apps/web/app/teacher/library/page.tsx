'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type { MeLibraryPayload } from '@/lib/library-types';

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function DueChip({ daysLeft, dueOn }: { daysLeft: number; dueOn: string }) {
  const cls =
    daysLeft < 0
      ? 'bg-[var(--sk-bad-tint)] text-[var(--sk-bad)]'
      : daysLeft <= 3
        ? 'bg-[var(--sk-amber-tint)] text-[var(--sk-amber-ink)]'
        : 'bg-[var(--sk-good-tint)] text-[var(--sk-good)]';
  const label =
    daysLeft < 0
      ? `${-daysLeft}d late · was due ${fmtDay(dueOn)}`
      : daysLeft === 0
        ? 'due today'
        : `due ${fmtDay(dueOn)}`;
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>;
}

export default function TeacherLibraryPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const shelf = useQuery({
    queryKey: ['me-library', host],
    enabled: !!host,
    retry: false,
    queryFn: () => api.get<MeLibraryPayload>('/me/library'),
  });

  if (shelf.error instanceof ApiError && shelf.error.status === 403) {
    return (
      <div className="mx-auto max-w-md py-12 text-center text-sm text-[var(--sk-ink-3)]">
        📚 The library isn&rsquo;t part of your school&rsquo;s plan yet.
      </div>
    );
  }
  if (shelf.error instanceof ApiError && shelf.error.status === 404) {
    // A SCHOOL_ADMIN peeking at the teacher portal has no teacher shelf.
    return (
      <div className="mx-auto max-w-md py-12 text-center text-sm text-[var(--sk-ink-3)]">
        📚 Only teacher logins have a library shelf.
      </div>
    );
  }
  if (shelf.isLoading || !shelf.data) {
    return <p className="py-10 text-center text-sm text-[var(--sk-ink-3)]">Fetching your books…</p>;
  }
  const d = shelf.data;

  const section = (label: string) => (
    <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--sk-ink-3)] first:mt-0">
      {label}
    </p>
  );
  const card = 'rounded-xl border border-[var(--sk-line)] bg-[var(--sk-card)] shadow-sm overflow-hidden';
  const row = 'flex items-center gap-3 border-b border-[var(--sk-line)] px-4 py-2.5 text-sm last:border-b-0';

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 font-serif text-xl font-semibold text-[var(--sk-ink)]" style={{ fontFamily: 'var(--sk-serif)' }}>
        Library
      </h1>

      {section(`Holding now · ${d.holdings.length} of ${d.limit}`)}
      <div className={card}>
        {d.holdings.length ? (
          d.holdings.map((h) => (
            <div key={h.issueId} className={row}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-[var(--sk-ink)]">
                  {h.title} <span className="font-normal text-[var(--sk-ink-3)]">— {h.author}</span>
                </div>
                <div className="font-mono text-[11px] text-[var(--sk-ink-3)]">
                  {h.accessionNo} · issued {fmtDay(h.issuedOn)}
                </div>
              </div>
              <DueChip daysLeft={h.daysLeft} dueOn={h.dueOn} />
              {d.finesEnabled && h.accruedFineRupees > 0 ? (
                <span className="whitespace-nowrap rounded-full bg-[var(--sk-bad-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-bad)]">
                  {rupees(h.accruedFineRupees)} so far
                </span>
              ) : null}
            </div>
          ))
        ) : (
          <div className="px-4 py-5 text-center text-sm text-[var(--sk-ink-3)]">Nothing out — visit the library!</div>
        )}
      </div>

      {d.finesEnabled ? (
        <>
          {section('Fines')}
          <div className={card}>
            {d.fines.length ? (
              d.fines.map((f) => (
                <div key={f.id} className={row}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-[var(--sk-ink)]">{f.title}</div>
                    <div className="text-xs text-[var(--sk-ink-3)]">
                      {f.reason === 'LOST' ? 'lost — replacement' : 'returned late'}
                    </div>
                  </div>
                  <span className="rounded-full bg-[var(--sk-bad-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-bad)]">
                    {rupees(f.amountRupees)}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-4 py-4 text-center text-sm text-[var(--sk-ink-3)]">
                No fines — everything&rsquo;s on time.
              </div>
            )}
          </div>
          {d.finesDueRupees > 0 ? (
            <p className="mt-2 text-xs text-[var(--sk-ink-3)]">
              <b className="text-[var(--sk-ink-2)]">{rupees(d.finesDueRupees)} due</b> — pay at the counter.
            </p>
          ) : null}
        </>
      ) : null}

      {section('History')}
      <div className={card}>
        {d.history.length ? (
          d.history.map((h) => (
            <div key={h.issueId} className={row}>
              <div className="min-w-0 flex-1 truncate font-semibold text-[var(--sk-ink)]">
                {h.title} <span className="font-normal text-[var(--sk-ink-3)]">— {h.author}</span>
              </div>
              <span className="whitespace-nowrap rounded-full bg-[var(--sk-brand-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-brand-2)]">
                {h.wasLost ? 'lost' : `returned ${fmtDay(h.returnedOn)}`}
              </span>
            </div>
          ))
        ) : (
          <div className="px-4 py-4 text-center text-sm text-[var(--sk-ink-3)]">No history yet.</div>
        )}
      </div>
    </div>
  );
}
