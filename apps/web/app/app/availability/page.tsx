'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import {
  DAY_NAMES,
  buildAvailability,
  currentPeriodId,
  freeInCell,
  type AvailabilityResponse,
} from '@/lib/availability';

/**
 * Who can cover a class, and when.
 *
 * THE OLD PAGE ANSWERED A QUESTION NOBODY ASKS. It listed thirty teachers, one
 * row each, nine period pills per row, one day at a time — so answering "who is
 * free in Period 3 on Thursday?" meant reading all thirty rows and counting to
 * the third pill in each. That is 270 identically-sized pills for a single day,
 * and the answer was never written anywhere; the admin assembled it by eye,
 * every time.
 *
 * It also HID A SIXTH OF THE WEEK. `DAYS` was hardcoded Monday–Friday. Raffles
 * teaches six days, the API returns all 720 slots including Saturday's 120, and
 * the page silently threw them away — an admin covering a Saturday absence saw
 * nothing at all, with no hint the day existed.
 *
 * So the surface is now the WEEK, the unit is the CELL (a day and a period),
 * and the answer is a list of names. The days come from the timetable data
 * rather than a constant, which is what makes it impossible for a school to be
 * hidden from itself again.
 */
export default function AvailabilityPage(): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const { data, isLoading, error } = useQuery({
    queryKey: ['availability'],
    queryFn: () => api.get<AvailabilityResponse>('/manage/availability'),
    enabled: !!host,
  });

  const [selected, setSelected] = useState<{ day: number; periodId: string } | null>(null);
  const [search, setSearch] = useState('');

  const model = useMemo(() => buildAvailability(data), [data]);
  const { days, periods, teachers, load, busySet } = model;

  // Opens on the period that is actually running. Cover is nearly always
  // needed for the current hour or the next one, so making the admin navigate
  // there on every visit was work the page could do itself.
  const now = useMemo(() => currentPeriodId(periods, new Date()), [periods]);
  useEffect(() => {
    if (selected || !periods.length || !days.length) return;
    const day = days.includes(now.day) ? now.day : days[0];
    const periodId = now.periodId ?? periods.find((p) => p.kind !== 'BREAK')?.id;
    if (periodId) setSelected({ day, periodId });
  }, [selected, periods, days, now]);

  const matches = search.trim().toLowerCase();
  const found = matches
    ? teachers.filter((t) => `${t.firstName} ${t.lastName}`.toLowerCase().includes(matches))
    : [];

  const selectedFree = selected ? freeInCell(model, selected.day, selected.periodId) : [];
  const selectedPeriod = periods.find((p) => p.id === selected?.periodId);

  return (
    <>
      <header className="sk-pagehead">
        <h1>Teacher availability</h1>
        <p>Pick an hour to see who is free to cover it.</p>
      </header>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>The week</h3>
          <span className="sp" />
          <input
            type="search"
            className="sk-input"
            aria-label="Find a teacher"
            placeholder="Find a teacher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 220 }}
          />
        </div>
        <div className="sk-card-b">
          {isLoading && <p className="sk-state">Loading…</p>}
          {!!error && <p className="sk-state err">{(error as Error).message}</p>}

          {!isLoading && !error && teachers.length === 0 && (
            <p className="sk-state">No teachers yet — add teachers first.</p>
          )}
          {!isLoading && !error && teachers.length > 0 && periods.length === 0 && (
            <p className="sk-state">No periods defined yet.</p>
          )}
          {!isLoading && !error && teachers.length > 0 && periods.length > 0 && days.length === 0 && (
            <p className="sk-state">
              No timetable has been assigned yet, so there is nothing to be free from.
            </p>
          )}

          {/* SEARCH FLIPS THE AXIS BACK. "Is Mrs Rao free on Thursday?" is a
              real question, just not the common one — so the teacher-first view
              is kept, reachable by naming the teacher rather than by being the
              default everyone pays for. */}
          {found.length > 0 && (
            <div data-testid="teacher-week" style={{ marginBottom: 18 }}>
              {found.map((t) => (
                <div key={t.id} style={{ marginBottom: 14 }}>
                  <div className="nm" style={{ marginBottom: 6 }}>
                    {t.firstName} {t.lastName}
                    <span className="meta" style={{ marginLeft: 8 }}>
                      {load.get(t.id) ?? 0} periods a week
                    </span>
                  </div>
                  <div className="sk-availgrid" style={{ gridTemplateColumns: `92px repeat(${days.length}, minmax(0, 1fr))` }}>
                    <span />
                    {days.map((d) => (
                      <span key={d} className="sk-availhead">{DAY_NAMES[d]?.slice(0, 3)}</span>
                    ))}
                    {periods.map((p) => (
                      <React.Fragment key={p.id}>
                        <span className="sk-availrow">{p.label}</span>
                        {days.map((d) => {
                          if (p.kind === 'BREAK') return <span key={d} className="sk-availcell" data-tone="break">—</span>;
                          const busy = busySet.has(`${t.id}-${d}-${p.id}`);
                          return (
                            <span
                              key={d}
                              className="sk-availcell"
                              data-tone={busy ? 'busy' : 'free'}
                              title={`${DAY_NAMES[d]} · ${p.label}: ${busy ? 'teaching' : 'free'}`}
                            >
                              {busy ? 'Teaching' : 'Free'}
                            </span>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!matches && days.length > 0 && periods.length > 0 && (
            <div className="sk-availwrap">
              <div
                className="sk-availgrid"
                role="grid"
                aria-label="Teachers free, by day and period"
                data-testid="availability-grid"
                style={{ gridTemplateColumns: `108px repeat(${days.length}, minmax(0, 1fr))` }}
              >
                <span />
                {days.map((d) => (
                  <span key={d} className="sk-availhead" data-now={d === now.day}>
                    {DAY_NAMES[d]?.slice(0, 3)}
                  </span>
                ))}

                {periods.map((p) => (
                  <React.Fragment key={p.id}>
                    <span className="sk-availrow" data-now={p.id === now.periodId}>
                      {p.label}
                    </span>
                    {days.map((d) => {
                      // A BREAK is drawn as a gap. Counting it as an hour when
                      // the whole staff is "free" would put the largest number
                      // on the page against the one time nobody can teach.
                      if (p.kind === 'BREAK') {
                        return (
                          <span key={d} className="sk-availcell" data-tone="break" aria-hidden="true">
                            —
                          </span>
                        );
                      }
                      const free = freeInCell(model, d, p.id).length;
                      const tone = free === 0 ? 'none' : free <= 3 ? 'tight' : 'free';
                      const on = selected?.day === d && selected?.periodId === p.id;
                      return (
                        <button
                          key={d}
                          type="button"
                          className="sk-availcell sk-press"
                          data-tone={tone}
                          data-on={on}
                          data-testid={`cell-${d}-${p.id}`}
                          aria-pressed={on}
                          onClick={() => setSelected({ day: d, periodId: p.id })}
                        >
                          {/* THE COUNT IS THE CONTENT. Colour is the second
                              signal, for scanning where the week runs thin —
                              a cell that only had a colour would make the
                              admin decode it before reading it. */}
                          <b>{free}</b>
                          <small>free</small>
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>

              <div className="sk-availpanel" data-testid="free-panel">
                {selected && selectedPeriod ? (
                  <>
                    <h4>
                      {DAY_NAMES[selected.day]} · {selectedPeriod.label}
                    </h4>
                    <p className="meta">
                      {selectedFree.length} of {teachers.length} teachers free
                      {selectedFree.length > 0 ? ' · least loaded first' : ''}
                    </p>
                    {selectedFree.length === 0 ? (
                      <p className="sk-state">
                        Everyone is teaching in this period. Try the hour either side.
                      </p>
                    ) : (
                      selectedFree.map((t) => (
                        <div key={t.id} className="sk-row" data-testid={`free-${t.id}`}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="nm">
                              {t.firstName} {t.lastName}
                            </div>
                            {/* RANKED BY LOAD, NOT ALPHABET. Sorting by name
                                means the same few people absorb every cover.
                                This is the whole week's teaching count, which
                                is the fairest signal available without new
                                data — it is labelled as what it is, not
                                dressed up as a count of covers already done. */}
                            <div className="meta">{load.get(t.id) ?? 0} periods a week</div>
                          </div>
                          <span className="sp" />
                          <span
                            className="sk-pill"
                            data-tone={(load.get(t.id) ?? 0) <= (model.medianLoad ?? 0) ? 'good' : 'warn'}
                          >
                            {(load.get(t.id) ?? 0) <= (model.medianLoad ?? 0) ? 'Lighter week' : 'Busier week'}
                          </span>
                        </div>
                      ))
                    )}
                  </>
                ) : (
                  <p className="sk-state">Pick an hour on the left.</p>
                )}
              </div>
            </div>
          )}

          {matches && found.length === 0 && (
            <p className="sk-state">No teacher matches “{search}”.</p>
          )}
        </div>
      </div>
    </>
  );
}
