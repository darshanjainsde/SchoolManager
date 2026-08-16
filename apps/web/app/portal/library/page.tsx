'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type { MeLibraryPayload } from '@/lib/library-types';

/** '2026-08-30' → '30 Aug'. */
function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * The approved "bookmark ribbon": a ribbon on the card's right edge that
 * drains as the due date nears — green, then amber (≤3 days), then red
 * (overdue). The chip beside it says the same thing in words, so colour is
 * never the only signal.
 */
function ribbonFor(daysLeft: number, loanDays: number) {
  const tone = daysLeft < 0 ? 'late' : daysLeft <= 3 ? 'soon' : 'ok';
  const pct = Math.max(8, Math.min(86, Math.round((86 * daysLeft) / Math.max(1, loanDays))));
  return { tone, pct } as const;
}

const RIBBON_BG = {
  ok: 'var(--sk-good)',
  soon: 'var(--sk-amber)',
  late: 'var(--sk-bad)',
} as const;
const CHIP_CLASS = {
  ok: 'bg-[var(--sk-good-tint)] text-[var(--sk-good)]',
  soon: 'bg-[var(--sk-amber-tint)] text-[var(--sk-amber-ink)]',
  late: 'bg-[var(--sk-bad-tint)] text-[var(--sk-bad)]',
} as const;

export default function PortalLibraryPage() {
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
  if (shelf.isLoading || !shelf.data) {
    return <p className="py-10 text-center text-sm text-[var(--sk-ink-3)]">Fetching your books…</p>;
  }
  const d = shelf.data;
  const free = Math.max(0, d.limit - d.holdings.length);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div>
        <h1 className="font-serif text-xl font-semibold text-[var(--sk-ink)]" style={{ fontFamily: 'var(--sk-serif)' }}>
          Your library
        </h1>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-brand-tint)] px-3.5 py-2.5 text-xs font-semibold text-[var(--sk-brand-2)]">
        {/* Glyph in its own node — never concatenated into the copy string
            (assertions and screen readers both read the words alone). */}
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true">📚</span>
          <span>Holding {d.holdings.length} of {d.limit}</span>
        </span>
        <span>{free > 0 ? `you can borrow ${free} more` : 'return one to borrow more'}</span>
      </div>

      {d.finesEnabled && d.finesDueRupees > 0 ? (
        <div
          className="flex items-center justify-between gap-2 rounded-xl border border-[var(--sk-bad)] bg-[var(--sk-bad-tint)] px-3.5 py-2.5 text-xs font-semibold text-[var(--sk-bad)]"
          data-testid="fine-banner"
        >
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">💰</span>
            <span>{rupees(d.finesDueRupees)} to clear at the counter</span>
          </span>
          <span>
            {d.fines.length
              ? `${d.fines.length} fine${d.fines.length > 1 ? 's' : ''}`
              : 'grows daily while a book is late'}
          </span>
        </div>
      ) : null}

      {d.holdings.length ? (
        d.holdings.map((h) => {
          const { tone, pct } = ribbonFor(h.daysLeft, d.loanDays);
          const chip =
            h.daysLeft < 0
              ? `⚠️ ${-h.daysLeft} day${h.daysLeft === -1 ? '' : 's'} late${h.accruedFineRupees ? ` · ${rupees(h.accruedFineRupees)} so far` : ''}`
              : h.daysLeft === 0
                ? '⏳ due today!'
                : h.daysLeft <= 3
                  ? `⏳ ${h.daysLeft} day${h.daysLeft > 1 ? 's' : ''} left — due ${fmtDay(h.dueOn)}`
                  : `🟢 ${h.daysLeft} days left`;
          return (
            <div
              key={h.issueId}
              className="relative rounded-xl border border-[var(--sk-line)] bg-[var(--sk-card)] py-3 pl-3.5 pr-9 shadow-sm"
            >
              <span
                aria-hidden="true"
                className="absolute right-3.5 top-0 w-2"
                style={{
                  height: `${pct}%`,
                  background: RIBBON_BG[tone],
                  clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 88%, 0 100%)',
                  transition: 'height 1s ease-out',
                }}
              />
              <div className="font-serif text-sm font-semibold text-[var(--sk-ink)]" style={{ fontFamily: 'var(--sk-serif)' }}>
                {h.title}
              </div>
              <div className="text-xs text-[var(--sk-ink-3)]">
                {h.author} · {h.accessionNo}
              </div>
              <span className={`mt-1.5 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${CHIP_CLASS[tone]}`}>
                {chip}
              </span>
            </div>
          );
        })
      ) : (
        <div className="rounded-xl border border-[var(--sk-line)] bg-[var(--sk-card)] px-4 py-6 text-center text-sm text-[var(--sk-ink-3)]">
          No books at home. The shelf awaits!
        </div>
      )}

      <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--sk-ink-3)]">History</p>
      <div className="rounded-xl border border-[var(--sk-line)] bg-[var(--sk-card)] px-3.5 py-1">
        {d.history.length ? (
          d.history.map((h) => (
            <div
              key={h.issueId}
              className="flex items-center justify-between gap-2 border-b border-dashed border-[var(--sk-line)] py-2 text-xs last:border-b-0"
            >
              <span className="truncate font-semibold text-[var(--sk-ink-2)]">{h.title}</span>
              <span className="whitespace-nowrap text-[var(--sk-ink-3)]">
                {h.wasLost ? 'lost' : `returned ${fmtDay(h.returnedOn)}`}
              </span>
            </div>
          ))
        ) : (
          <div className="py-2 text-center text-xs text-[var(--sk-ink-3)]">Nothing returned yet.</div>
        )}
      </div>
    </div>
  );
}
