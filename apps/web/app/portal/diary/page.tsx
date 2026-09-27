'use client';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DiaryDayMark, DiarySignResult, StudentDiaryEntry, StudentDiaryResult } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(iso: string): string {
  if (iso === todayIso()) return 'Today';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** The full date a panel heading uses — "Thursday 17 September". */
function longDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** `YYYY-MM` n months either side. Month 0 of the next year is December. */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Monday-first, because that is how an Indian school week is read and how the
 * attendance calendar next door already draws it.
 */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** How many blank squares sit before the 1st. ISO weekday 1 = Monday. */
function leadingBlanks(firstDate: string): number {
  const js = new Date(`${firstDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) - 1;
}

/**
 * What one square says. The order matters: a remark still to sign outranks
 * everything, because it is the only state that asks the reader to do
 * something.
 */
function markState(d: DiaryDayMark, today: string): 'remark' | 'items' | 'off' | 'future' | 'none' {
  if (d.unsigned > 0) return 'remark';
  if (d.items + d.remarks > 0) return 'items';
  if (d.offReason) return 'off';
  if (d.date > today) return 'future';
  return 'none';
}

/** What a square is called out loud, so the grid is usable without seeing it. */
function markSaid(d: DiaryDayMark, state: string): string {
  if (state === 'remark') return `${d.unsigned} remark${d.unsigned > 1 ? 's' : ''} to sign`;
  if (state === 'items') return `${d.items + d.remarks} written`;
  if (state === 'off') return d.offReason ?? 'no school';
  if (state === 'future') return 'still to come';
  return 'nothing written';
}

/**
 * A signature that writes itself.
 *
 * A green tick would say "the request succeeded". This says "you signed it",
 * which is what the action actually was — the nib travelling across the line
 * is the whole point, so it is an SVG stroke rather than an icon. The path is
 * a fixed squiggle, not a rendering of the typed name: it stands for a
 * signature, and pretending to reproduce someone's hand would be a lie about
 * what was captured.
 *
 * `sk-sig`/`sk-in` come from sk-theme.css, which also collapses this to the
 * finished stroke under `prefers-reduced-motion: reduce`.
 */
function DrawnSignature(): React.JSX.Element {
  return (
    <svg
      className="sk-sig sk-in"
      width="46"
      height="16"
      viewBox="0 0 46 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12 C8 2 11 14 16 7 S24 12 30 6 S40 12 44 5" />
    </svg>
  );
}

/**
 * The diary at home, on the web (Phase 5·3) — the same pages the app shows,
 * grouped by day with the red margin rule on a remark and a signature line
 * under it. It reuses the teacher page's `.sk-diary-item` treatment on
 * purpose: a family opening the entry they were emailed about must recognise
 * it as the same object the teacher wrote, not as a second rendering of it.
 *
 * Copy is role-neutral for the same reason the app's is: one STUDENT login
 * serves both the student and whoever at home uses it, so nothing here
 * addresses the reader as a parent.
 */
export default function PortalDiaryPage(): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);

  // One request per month, carrying every day's marks AND every entry in it,
  // so opening a date costs nothing. A class's month of diary is on the order
  // of a hundred lines; a request per day would be a round trip per tap.
  const key = ['p-diary', host, month];
  const query = useQuery({
    queryKey: key,
    enabled: !!host,
    queryFn: () => api.get<StudentDiaryResult>(`/me/diary?month=${month}`),
  });

  const sign = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.post<DiarySignResult>(`/me/diary/${id}/sign`, { signedName: name }),
    onSuccess: () => {
      toast.success('Signed.');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);
  const cal = query.data?.month ?? null;

  // Grouped newest-first — the shape the page has always rendered, and the
  // fallback when the API predates the month grid (the web deploys first, and
  // an empty calendar would be worse than the list it replaced).
  const days = useMemo(() => {
    const out: { date: string; entries: StudentDiaryEntry[] }[] = [];
    for (const entry of entries) {
      const last = out[out.length - 1];
      if (last && last.date === entry.date) last.entries.push(entry);
      else out.push({ date: entry.date, entries: [entry] });
    }
    return out;
  }, [entries]);

  // The day the panel is showing. Nothing picked yet means today when today is
  // in this month, otherwise the last day that has anything on it — opening a
  // past month on its 1st, which is usually empty, tells the reader nothing.
  const selected = useMemo(() => {
    if (picked) return picked;
    if (month === today.slice(0, 7)) return today;
    const withSomething = [...(cal?.days ?? [])].reverse().find((d) => d.items + d.remarks > 0);
    return withSomething?.date ?? cal?.days[0]?.date ?? today;
  }, [picked, month, today, cal]);

  const selectedEntries = useMemo(
    () => entries.filter((e) => e.date === selected),
    [entries, selected],
  );
  const selectedMark = useMemo(
    () => cal?.days.find((d) => d.date === selected) ?? null,
    [cal, selected],
  );

  const goMonth = (by: number) => {
    setMonth((m) => shiftMonth(m, by));
    // The picked date belongs to the month it was picked in.
    setPicked(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Diary</h1>
        <p>
          Every school day of the year. Open any date to see what the class was given
          {query.data && query.data.unsignedCount > 0
            ? ` — ${query.data.unsignedCount} remark${query.data.unsignedCount > 1 ? 's' : ''} still to sign.`
            : '.'}
        </p>
      </header>

      {query.isLoading && <p className="sk-state">Opening the diary…</p>}
      {query.error && <QueryError error={query.error} onRetry={query.refetch} className="py-6" />}

      {cal && !query.isLoading && !query.error && (
        <div className="sk-dcal">
          <section className="sk-card" aria-label={`Diary for ${monthLabel(cal.month)}`}>
            <div className="sk-card-b">
              <div className="sk-dcal-head">
                <button
                  type="button"
                  className="sk-dcal-arrow"
                  aria-label="Previous month"
                  data-testid="diary-prev-month"
                  disabled={shiftMonth(cal.month, -1) < cal.firstMonth}
                  onClick={() => goMonth(-1)}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <h3>{monthLabel(cal.month)}</h3>
                <button
                  type="button"
                  className="sk-dcal-arrow"
                  aria-label="Next month"
                  data-testid="diary-next-month"
                  disabled={shiftMonth(cal.month, 1) > cal.lastMonth}
                  onClick={() => goMonth(1)}
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>

              <div className="sk-cal" role="group" aria-label={`Days of ${monthLabel(cal.month)}`}>
                {WEEKDAYS.map((w, i) => (
                  <div key={`${w}-${i}`} aria-hidden="true" className="wd">{w}</div>
                ))}
                {Array.from({ length: leadingBlanks(cal.days[0]?.date ?? `${cal.month}-01`) }, (_, i) => (
                  <div key={`blank-${i}`} aria-hidden="true" />
                ))}
                {cal.days.map((d) => {
                  const state = markState(d, today);
                  return (
                    <button
                      key={d.date}
                      type="button"
                      className="sk-cell"
                      data-diary={state}
                      data-today={d.date === today}
                      data-selected={d.date === selected}
                      data-testid={`diary-day-${d.date}`}
                      aria-label={`${longDayLabel(d.date)}: ${markSaid(d, state)}`}
                      aria-pressed={d.date === selected}
                      onClick={() => setPicked(d.date)}
                    >
                      {Number(d.date.slice(8))}
                      {d.unsigned > 0 && <span className="sk-cell-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>

              <div className="sk-legend">
                <span><b style={{ background: 'var(--sk-brand-tint)' }} />Something to do</span>
                <span><b style={{ background: 'var(--sk-amber-ink)' }} />Remark to sign</span>
                <span><b style={{ background: 'var(--sk-card)', border: '1px solid var(--sk-line)' }} />Nothing written</span>
                <span><b style={{ background: 'var(--sk-bg-2)' }} />No school</span>
              </div>
            </div>
          </section>

          <section className="sk-card" aria-label="The day you picked">
            <div className="sk-card-h">
              <h3>{longDayLabel(selected)}</h3>
            </div>
            <div className="sk-card-b">
              {selectedEntries.length > 0 ? (
                <DayEntries entries={selectedEntries} drafts={drafts} setDrafts={setDrafts} sign={sign} />
              ) : (
                /* An empty day is an ANSWER, so it says which kind of empty it
                   is. "Nothing here" alone leaves a reader wondering whether
                   they are looking at the wrong date. */
                <div className="sk-dcal-empty" data-testid="diary-empty-day">
                  <CalendarDays size={26} aria-hidden="true" style={{ color: 'var(--sk-ink-3)' }} />
                  <span className="t">
                    {selectedMark?.offReason
                      ? 'No school on this day'
                      : selected > today
                        ? 'Still to come'
                        : 'Nothing was written'}
                  </span>
                  <p className="w">
                    {selectedMark?.offReason
                      ? `${selectedMark.offReason}. The school was closed, so there is nothing to read.`
                      : selected > today
                        ? 'This day has not happened yet. Anything set for it turns up here.'
                        : 'No teacher wrote anything on this day. That is normal — not every day has homework.'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* The API that predates the month grid answers without `month`. The
          list it used to show is still right, so it is what a family gets for
          the few minutes between the web deploying and the API following. */}
      {!cal && !query.isLoading && !query.error && entries.length === 0 && (
        <div className="sk-card">
          <div className="sk-card-b">
            <p className="sk-state">
              Nothing in the diary this month. Anything a teacher writes turns up here.
            </p>
          </div>
        </div>
      )}

      {!cal && days.map((day) => (
        <div className="sk-card" key={day.date}>
          <div className="sk-card-h">
            <h3>{dayLabel(day.date)}</h3>
          </div>
          <div className="sk-card-b">
            <DayEntries entries={day.entries} drafts={drafts} setDrafts={setDrafts} sign={sign} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One day's slips.
 *
 * Lifted out of the page unchanged when the month grid arrived, so the
 * calendar's day panel and the fallback list render an entry the SAME way —
 * two copies of this would drift, and a family opening the entry they were
 * emailed about has to recognise it as the same object the teacher wrote.
 */
function DayEntries({ entries, drafts, setDrafts, sign }: {
  entries: StudentDiaryEntry[];
  drafts: Record<string, string>;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  sign: UseMutationResult<DiarySignResult, Error, { id: string; name: string }>;
}): React.JSX.Element {
  return (
    <>
      {/* Same `pinin` drop as the teacher's page — the day's entries pin
          themselves onto the page as it opens, staggered so they read as
          separate slips rather than one block appearing. */}
      {entries.map((e, i) => {
        const red = e.kind === 'REMARK';
        return (
          <div
            key={e.id}
            data-testid={`diary-${e.id}`}
            className="sk-diary-item sk-pinin sk-in"
            data-kind={e.kind}
            style={{ animationDelay: `${Math.min(i, 8) * 0.07}s` }}
          >
            <span className="sdot" aria-hidden="true" />
            <div className="di-body">
              <div className="di-sub">
                {e.subjectName ?? 'Diary'}
                {red && <span className="sk-rem-tag">REMARK</span>}
              </div>
              <div className="di-txt">{e.body}</div>
              <div className="di-by">
                {e.teacherName}
                {e.personal ? ' · written for you' : ' · for the whole class'}
              </div>

              {red &&
                (e.signedAt ? (
                  // Signed: the drawn signature replaces the form. The name is
                  // shown beside it because the stroke says "signed" and only
                  // the text says "by whom".
                  <div className="sk-signed" data-testid={`signed-${e.id}`}>
                    <DrawnSignature />
                    <span>Signed by {e.signedName}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2" style={{ marginTop: 10, maxWidth: 380 }}>
                    <p className="sk-state" style={{ padding: 0 }}>
                      A copy has already been emailed home. Sign to tell the teacher it was read.
                    </p>
                    <Input
                      data-testid={`sign-name-${e.id}`}
                      placeholder="Who is signing?"
                      value={drafts[e.id] ?? ''}
                      onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
                    />
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      data-variant="primary"
                      data-testid={`sign-${e.id}`}
                      disabled={!(drafts[e.id] ?? '').trim() || sign.isPending}
                      onClick={() => sign.mutate({ id: e.id, name: (drafts[e.id] ?? '').trim() })}
                    >
                      {sign.isPending ? 'Signing…' : 'Sign this remark'}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
