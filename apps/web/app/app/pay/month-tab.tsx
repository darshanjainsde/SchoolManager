'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import RunPanel from './run-panel';
import LeavePanel from './leave-panel';
import { HowPayWorks, HowPayWorksLink, useHowPayWorksHidden } from './how-pay-works';
import { Card, CardBody, CardHead, EmptyRow, RulesAsAt, RunPill, monthName, rupees } from './ui';
import type { Overview, SalarySettings } from './types';

const now = new Date();

/**
 * How this month compares with the last one the school actually paid.
 *
 * Deliberately vague where being precise would be false: two runs a month
 * apart differ by joiners, leavers and days, so "about the same" is the true
 * statement and a percentage to one decimal place is not.
 */
function versusLast(nowMinor: number, prevMinor: number | null): string | null {
  if (!prevMinor || prevMinor <= 0) return null;
  const delta = (nowMinor - prevMinor) / prevMinor;
  if (Math.abs(delta) < 0.02) return 'about the same as last month';
  const pct = Math.round(Math.abs(delta) * 100);
  return `${pct}% ${delta > 0 ? 'more' : 'less'} than last month`;
}

/**
 * THIS MONTH — the home screen.
 *
 * The module has two completely different lives and the old screen served
 * neither: it opened on a month picker above "No month has been run yet",
 * asking a question before it had said what the room was for.
 *
 * SETUP happens once and needs a path. THE MONTH happens twelve times a year
 * and needs almost no decisions at all. So the page changes shape instead of
 * asking the same question forever, and there is no month picker: there is
 * always exactly one month that wants running, and asking which is asking the
 * user to do the product's arithmetic.
 */
export default function MonthTab({ base }: { base: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [howHidden, setHowHidden] = useHowPayWorksHidden();

  const settings = useQuery({
    queryKey: ['pay-settings'], enabled: !!host,
    queryFn: () => api.get<SalarySettings>('/payroll/settings'),
  });
  const overview = useQuery({
    queryKey: ['pay-overview'], enabled: !!host,
    queryFn: () => api.get<Overview>('/payroll/overview'),
  });

  const openRun = useMutation({
    mutationFn: (v: { year: number; month: number }) => api.post<{ id: string }>('/payroll/runs', v),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pay-overview'] }); void qc.invalidateQueries({ queryKey: ['pay-runs'] }); },
    onError: (e: Error) => setError(e.message),
  });

  if (overview.isError) return <QueryError error={overview.error} onRetry={overview.refetch} className="py-8" />;
  if (!overview.data) return <div className="sk-state" aria-busy="true">Loading…</div>;

  const o = overview.data;
  const { year, month } = o.period;
  const label = `${monthName(month)} ${year}`;
  const s = settings.data;

  // ── setup is not done: a path, not a form ─────────────────────────────
  if (!o.setup.ready) {
    const steps = [
      {
        // Not "done" until a state is set: professional tax and ESI thresholds
        // are decided by it, and with it unset they are silently zero.
        state: s?.region ? ('done' as const) : ('now' as const),
        title: 'Where the school is',
        detail: s?.region
          ? `${s.pack.label} · ${s.region}. This decides provident fund, ESI and professional tax.`
          : `${s?.pack.label ?? 'The country'} is set. The STATE is not — professional tax and ESI depend on it, and stay at zero until it is.`,
        action: s?.region ? null : { href: `${base}/settings`, label: 'Set the state' },
      },
      {
        state: o.setup.gradeCount > 0 ? ('done' as const) : ('now' as const),
        title: 'Make your grades',
        detail: o.setup.gradeCount > 0
          ? `${o.setup.gradeCount} ${o.setup.gradeCount === 1 ? 'grade' : 'grades'}. A grade holds the band and the split, so a person needs only a figure.`
          : `We can draft them from the ${o.setup.rosterSize} people already on your roll. Check the bands and keep the ones you want.`,
        action: { href: `${base}/grades`, label: o.setup.gradeCount > 0 ? 'Review grades' : 'Draft my grades' },
      },
      {
        state: o.setup.onPay > 0 ? ('done' as const) : (o.setup.gradeCount > 0 ? ('now' as const) : ('todo' as const)),
        title: 'Put people on a grade',
        detail: o.setup.onPay > 0
          ? `${o.setup.onPay} on the payroll, ${o.setup.notOnPay} still to go.`
          : `${o.setup.rosterSize} people waiting. Pick several at once — each needs a grade and a figure.`,
        action: o.setup.gradeCount > 0 ? { href: `${base}/people`, label: 'Put people on pay' } : null,
      },
      {
        state: 'todo' as const,
        title: 'Run the month',
        detail: 'Once anyone is on the payroll, this screen becomes the month and what it costs.',
        action: null,
      },
    ];

    return (
      <div className="sk-paystack">
        {howHidden
          ? <div className="flex justify-end"><HowPayWorksLink onShow={() => setHowHidden(false)} /></div>
          : <HowPayWorks base={base} onHide={() => setHowHidden(true)} />}
        <Card>
          <CardHead><h3>Set up Pay</h3><span className="sk-muted">Two steps and the first pay run is ready.</span></CardHead>
          <CardBody>
            <div className="sk-paysteps">
              {steps.map((st, i) => (
                <div key={st.title} className="sk-paystep" data-state={st.state}>
                  <span className="i" aria-hidden="true">{st.state === 'done' ? '✓' : i + 1}</span>
                  <div>
                    <div className="t">{st.title}</div>
                    <div className="d">{st.detail}</div>
                    {st.action ? (
                      <Link
                        className="sk-btn sk-press"
                        data-variant={st.state === 'now' ? 'primary' : undefined}
                        style={{ marginTop: 8 }}
                        href={st.action.href}
                      >
                        {st.action.label}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {s ? <RulesAsAt asAt={s.pack.rulesAsAt} version={s.pack.version} /> : null}
          </CardBody>
        </Card>
      </div>
    );
  }

  // ── the month ─────────────────────────────────────────────────────────
  const cost = o.cost;
  const compare = versusLast(cost.totalCostMinor, o.previousTotalMinor);
  const status = o.run?.status ?? null;
  const blocking = o.exceptions.filter((e) => e.kind === 'NO_PAY' || e.kind === 'NO_BANK');

  return (
    <div className="sk-paystack">
      {error ? <div className="sk-state" role="alert" style={{ color: 'var(--sk-bad)' }}>{error}</div> : null}

      <Card>
        <CardHead>
          <h3>{label}</h3>
          <span className="flex flex-wrap items-center gap-2">
            {howHidden ? <HowPayWorksLink onShow={() => setHowHidden(false)} /> : null}
            {status ? <RunPill status={status} /> : <span className="sk-pill" data-tone="warn">Not run yet</span>}
          </span>
        </CardHead>
        <CardBody className="sk-payhero">
          <div className="fig">
            <span className="lab">{cost.estimated ? `What ${monthName(month)} will cost the school` : `What ${monthName(month)} costs the school`}</span>
            <span className="big">{rupees(cost.totalCostMinor)}</span>
            <span className="sub">
              {cost.headcount} {cost.headcount === 1 ? 'person' : 'people'} on the payroll
              {compare ? ` · ${compare}` : ''}
              {cost.estimated ? ' · from the pay you have agreed, before tax is worked out' : ''}
            </span>
          </div>

          <div className="sk-paytrio">
            <div>
              <span className="v">{rupees(cost.netMinor)}</span>
              <span className="h">to their banks</span>
            </div>
            <div>
              <span className="v">{rupees(cost.deductionMinor)}</span>
              <span className="h">held back</span>
            </div>
            <div>
              <span className="v">{rupees(cost.employerCostMinor)}</span>
              <span className="h">school&rsquo;s own share</span>
            </div>
          </div>

          {o.exceptions.length > 0 ? (
            <div className="sk-payneeds">
              <span className="t">
                {o.exceptions.length === 1 ? '1 thing needs you' : `${o.exceptions.length} things need you`}
                {blocking.length > 0 ? ' first' : ''}
              </span>
              {o.exceptions.map((e) => (
                <div key={e.kind} className="sk-payneed">
                  <span className="who">
                    {e.label}
                    {e.count > 1 ? <span className="names">{e.names.join(', ')}{e.count > e.names.length ? ` and ${e.count - e.names.length} more` : ''}</span> : null}
                  </span>
                  {/* Every warning names the move that fixes it — a warning
                      that only states the discrepancy leaves the reader to
                      work out which control resolves it. */}
                  <Link className="sk-btn" data-size="sm" href={`${base}/${e.goTo}`}>
                    {e.goTo === 'grades' ? 'Open Grades' : 'Open People'}
                  </Link>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {!o.run ? (
              <button
                type="button" className="sk-btn sk-press" data-variant="primary"
                disabled={openRun.isPending}
                onClick={() => openRun.mutate({ year, month })}
              >
                {openRun.isPending ? 'Opening…' : `Start ${monthName(month)}`}
              </button>
            ) : null}
            <Link className="sk-btn" href={`${base}/people`}>People</Link>
            <Link className="sk-btn" href={`${base}/grades`}>Grades</Link>
          </div>

          {s ? <RulesAsAt asAt={s.pack.rulesAsAt} version={s.pack.version} /> : null}
        </CardBody>
      </Card>

      {/* Before the run panel on purpose: leave changes what the month costs,
          so it has to be settled before somebody works the month out. */}
      <LeavePanel year={year} month={month} />

      {o.run ? <RunPanel runId={o.run.id} base={base} /> : null}

      {!howHidden ? <HowPayWorks base={base} onHide={() => setHowHidden(true)} /> : null}

      <Card>
        <CardHead><h3>Earlier months</h3></CardHead>
        <CardBody>
          {o.recent.filter((r) => !(r.periodYear === year && r.periodMonth === month)).length === 0 ? (
            <EmptyRow>No month has been paid yet. The first one you lock will show here.</EmptyRow>
          ) : (
            <div>
              {o.recent
                .filter((r) => !(r.periodYear === year && r.periodMonth === month))
                .map((r) => (
                  <div key={r.id} className="sk-payrow">
                    <span className="who">
                      <span className="nm">{monthName(r.periodMonth)} {r.periodYear}</span>
                      <span className="meta">{r.headcount} {r.headcount === 1 ? 'person' : 'people'}</span>
                    </span>
                    <span className="amt">{rupees(r.grossMinor + r.employerCostMinor)}</span>
                    <RunPill status={r.status} />
                  </div>
                ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
