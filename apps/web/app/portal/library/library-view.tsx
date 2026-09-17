'use client';
import type { MeLibraryHolding, MeLibraryPayload } from '@/lib/library-types';

/**
 * The reader's library, laid out to answer what a family actually asks:
 * what is out and when is it due, is anything owed, what are the rules,
 * what has been read. Pure: the page owns the query and the three refusal
 * states, this owns nothing but the payload — so the screen audit can render
 * it with the longest real values and measure it.
 *
 * Same bones as the fees page: a `.sk-pagehead`, mono figures, `.sk-card`
 * sections, and grid tracks that collapse on a phone. Two columns from 900px
 * (shelf and fines on the left, the returned list and the rules on the
 * right) so a desktop is not a phone column with 1,600px of paper either side.
 */

/** '2026-08-30' → '30 Aug'. */
export function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Tone = 'ok' | 'soon' | 'late';
const toneOf = (daysLeft: number): Tone => (daysLeft < 0 ? 'late' : daysLeft <= 3 ? 'soon' : 'ok');
const PILL: Record<Tone, 'good' | 'warn' | 'bad'> = { ok: 'good', soon: 'warn', late: 'bad' };

/**
 * The approved "bookmark ribbon": a ribbon on the card's right edge that
 * drains as the due date nears — green, then amber (≤3 days), then red
 * (overdue). The chip beside it says the same thing in words, so colour is
 * never the only signal.
 */
export function ribbonPct(daysLeft: number, loanDays: number): number {
  return Math.max(8, Math.min(86, Math.round((86 * daysLeft) / Math.max(1, loanDays))));
}

/** The chip's words — no glyphs, the tone is carried by the pill's colour AND these words. */
export function dueWords(h: MeLibraryHolding): string {
  if (h.daysLeft < 0) return `${plural(-h.daysLeft, 'day')} late${h.accruedFineRupees ? ` · ${rupees(h.accruedFineRupees)} so far` : ''}`;
  if (h.daysLeft === 0) return `due today`;
  if (h.daysLeft <= 3) return `${plural(h.daysLeft, 'day')} left — due ${fmtDay(h.dueOn)}`;
  return `${h.daysLeft} days left — due ${fmtDay(h.dueOn)}`;
}

/** "2 books at a time · 14 days each · ₹5 a day late after 1 day's grace · lost book ₹120". */
export function rulesSentence(d: MeLibraryPayload): string {
  const parts = [`${plural(d.limit, 'book')} at a time`, `${d.loanDays} days each`];
  // `rules` arrived with this build's API. The web deploys before the API
  // (observed on the staging push), so for a minute — or a cached answer —
  // it is absent: say the limit and the loan, leave the money out.
  if (d.finesEnabled && d.rules) {
    const grace = d.rules.graceDays > 0 ? ` after ${d.rules.graceDays === 1 ? "1 day's" : `${d.rules.graceDays} days'`} grace` : '';
    parts.push(`${rupees(d.rules.finePerDayRupees)} a day late${grace}`, `lost book ${rupees(d.rules.lostFeeRupees)}`);
  }
  return parts.join(' · ');
}

export function LibraryView({ d }: { d: MeLibraryPayload }) {
  const free = Math.max(0, d.limit - d.holdings.length);
  const soonest = d.holdings[0] ?? null; // holdings arrive due-first
  const owes = d.finesEnabled && d.finesDueRupees > 0;
  const accruing = d.holdings.filter((h) => h.accruedFineRupees > 0);

  return (
    <div className="pl-page" data-testid="library-page">
      <header className="sk-pagehead">
        <div className="who">
          <h1>Your library</h1>
          <div className="meta" data-testid="library-rules">{rulesSentence(d)}</div>
        </div>
        <div className="bal">
          <div className="sk-lab">Holding {d.holdings.length} of {d.limit}</div>
          <div className="n" data-testid="library-free" style={{ color: free > 0 ? 'var(--sk-good)' : 'var(--sk-ink)' }}>
            {free > 0 ? free : 0}
            <span className="u"> free</span>
          </div>
          <div className="hint">{free > 0 ? `you can borrow ${free} more` : 'return one to borrow more'}</div>
        </div>
      </header>

      <div className="pl-figs">
        <div
          className="pl-fig"
          data-testid="library-next-due"
          data-tone={soonest ? (soonest.daysLeft < 0 ? 'bad' : soonest.daysLeft <= 3 ? 'warn' : 'good') : undefined}
        >
          <div className="k">Next due</div>
          <div className="n">{soonest ? (soonest.daysLeft < 0 ? 'Late' : soonest.daysLeft === 0 ? 'Today' : plural(soonest.daysLeft, 'day')) : '—'}</div>
          <div className="h">{soonest ? `${soonest.title} · ${fmtDay(soonest.dueOn)}` : 'nothing out'}</div>
        </div>
        {d.finesEnabled ? (
          <div className="pl-fig" data-testid="library-fine" data-tone={owes ? 'bad' : undefined}>
            <div className="k">Fine</div>
            <div className="n">{rupees(d.finesDueRupees)}</div>
            <div className="h">{owes ? 'clear at the counter' : 'nothing owed'}</div>
          </div>
        ) : null}
        <div className="pl-fig" data-testid="library-returned-count">
          <div className="k">Returned</div>
          <div className="n">{d.history.length}</div>
          <div className="h">{d.history.length ? 'books brought back' : 'none yet'}</div>
        </div>
      </div>

      <div className="pl-cols">
        <div className="pl-main">
          {owes ? (
            <section className="sk-card pl-fines" data-testid="fine-banner" style={{ borderColor: 'var(--sk-bad)' }}>
              <div className="sk-card-h">
                <h3>{rupees(d.finesDueRupees)} to clear at the counter</h3>
                <span className="sk-pill" data-tone="bad">
                  {d.fines.length ? plural(d.fines.length, 'fine') : 'grows daily while a book is late'}
                </span>
              </div>
              <div className="sk-card-b">
                <div className="pl-rows">
                  {d.fines.map((f) => (
                    <div className="pl-row" key={f.id}>
                      <div className="b">
                        <div className="t">{f.title}</div>
                        <div className="m">{f.reason === 'LOST' ? 'Marked lost' : 'Returned late'}</div>
                      </div>
                      <div className="r" data-tone="bad">{rupees(f.amountRupees)}</div>
                    </div>
                  ))}
                  {accruing.map((h) => (
                    <div className="pl-row" key={h.issueId}>
                      <div className="b">
                        <div className="t">{h.title}</div>
                        <div className="m">Still out · {plural(-h.daysLeft, 'day')} late — settles when it comes back</div>
                      </div>
                      <div className="r" data-tone="bad">{rupees(h.accruedFineRupees)} so far</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section className="sk-card" data-testid="library-shelf">
            <div className="sk-card-h">
              <h3>On the shelf</h3>
              <span className="sk-pill" data-tone={d.holdings.length ? 'info' : 'neutral'}>{d.holdings.length} of {d.limit}</span>
            </div>
            <div className="sk-card-b">
              {d.holdings.length ? (
                <div className="pl-shelf">
                  {d.holdings.map((h, i) => {
                    const tone = toneOf(h.daysLeft);
                    return (
                      <article className="pl-book" key={h.issueId} data-spine={i % 3} data-testid={`holding-${h.issueId}`}>
                        <span aria-hidden="true" className="pl-ribbon" data-tone={tone} style={{ height: `${ribbonPct(h.daysLeft, d.loanDays)}%` }} />
                        <div className="t">{h.title}</div>
                        <div className="m">
                          {h.author} · {h.accessionNo} · taken {fmtDay(h.issuedOn)}
                        </div>
                        <span className="sk-pill" data-tone={PILL[tone]}>{dueWords(h)}</span>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="sk-state" data-testid="library-empty">
                  Nothing out right now. You can take {plural(d.limit, 'book')} for {d.loanDays} days each — ask at the counter.
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="pl-side">
          <section className="sk-card" data-testid="library-history">
            <div className="sk-card-h">
              <h3>Returned</h3>
              {d.history.length ? <span className="sk-pill" data-tone="neutral">{plural(d.history.length, 'book')}</span> : null}
            </div>
            <div className="sk-card-b">
              {d.history.length ? (
                <div className="pl-rows">
                  {d.history.map((h) => (
                    <div className="pl-row" key={h.issueId}>
                      <div className="b">
                        <div className="t">{h.title}</div>
                        {h.author ? <div className="m">{h.author}</div> : null}
                      </div>
                      <div className="r" data-tone={h.wasLost ? 'bad' : undefined}>{h.wasLost ? 'marked lost' : `returned ${fmtDay(h.returnedOn)}`}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="sk-state">Nothing returned yet. Books you bring back are listed here.</p>
              )}
            </div>
          </section>

          <section className="sk-card">
            <div className="sk-card-h">
              <h3>How the library works</h3>
            </div>
            <div className="sk-card-b">
              <p className="pl-rules">
                Borrow up to <b>{plural(d.limit, 'book')}</b> at a time, for <b>{d.loanDays} days</b> each.
                {d.finesEnabled && d.rules ? (
                  <>
                    {' '}
                    A late book costs <b>{rupees(d.rules.finePerDayRupees)} a day</b>
                    {d.rules.graceDays > 0 ? ` after ${d.rules.graceDays === 1 ? 'one day' : `${d.rules.graceDays} days`} of grace` : ''}; a lost book is{' '}
                    <b>{rupees(d.rules.lostFeeRupees)}</b>. Fines are paid at the counter, never here.
                  </>
                ) : d.finesEnabled ? (
                  ' Late and lost books carry a fine, paid at the counter.'
                ) : (
                  ' No fines apply to you.'
                )}
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
