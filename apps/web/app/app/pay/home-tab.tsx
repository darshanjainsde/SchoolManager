'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { CalendarCheck, FileStack, Layers, Play, Users } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { HubDoor, HubDoors, HubList } from '@/components/ui/hub';
import { Cell, Figure, Figures, Row, RowTitle } from '@/components/ui/kit';
import { HowPayWorks, useHowPayWorksHidden } from './how-pay-works';
import { setupSteps } from './setup-steps';
import { Card, CardBody, CardHead, RulesAsAt, RunPill, monthName, rupees } from './ui';
import type { Overview, SalarySettings } from './types';

/**
 * PAY HOME — the front page of Pay, like Fees or Library have one.
 *
 * The month at a glance on the left, the guide on the right, the doors to
 * the sections, the months already paid. "This month" — the working screen
 * a run happens on — is its own tab now. It used to be the index, which put
 * the 17-step guide two screens under a table where nobody found it.
 *
 * The guide opens INLINE, right under the top row, from the poster or from
 * the "▶ How it works" chip in the tab strip (`?guide=1`) — within a screen
 * of the control that revealed it, never appended to the end of the page.
 * Before the first month is locked the poster is the hero and the setup
 * steps sit under it; after that it steps back to the small poster.
 */
export default function HomeTab({ base }: { base: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const params = useSearchParams();
  const askedForGuide = params?.get('guide') === '1';
  const [hidden, setHidden] = useHowPayWorksHidden();
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  const settings = useQuery({
    queryKey: ['pay-settings'], enabled: !!host,
    queryFn: () => api.get<SalarySettings>('/payroll/settings'),
  });
  const overview = useQuery({
    queryKey: ['pay-overview'], enabled: !!host,
    queryFn: () => api.get<Overview>('/payroll/overview'),
  });

  const o = overview.data;
  // Open by default while the school is still setting up (unless they hid
  // it), and whenever the chip asked for it. Decided once the data is here.
  const open = guideOpen ?? (askedForGuide || (!!o && !o.setup.ready && !hidden));
  useEffect(() => {
    if (askedForGuide) bringIntoView(guideRef.current);
  }, [askedForGuide, o]);

  if (overview.isError) return <QueryError error={overview.error} onRetry={overview.refetch} className="py-8" />;
  if (!o) return <div className="sk-state" aria-busy="true">Loading…</div>;

  const s = settings.data;
  const { year, month } = o.period;
  const label = `${monthName(month)} ${year}`;
  const showGuide = () => { setGuideOpen(true); setHidden(false); requestAnimationFrame(() => bringIntoView(guideRef.current)); };
  const hideGuide = () => { setGuideOpen(false); if (!o.setup.ready) setHidden(true); };
  const guide = open ? <div ref={guideRef}><HowPayWorks base={base} onHide={hideGuide} /></div> : null;

  // ── before the first run: the guide is the hero, then the path ────────
  if (!o.setup.ready) {
    const steps = setupSteps(o, s, base);
    return (
      <div className="sk-paystack" data-pay-home="setup">
        {!open && <GuidePoster hero onOpen={showGuide} />}
        {guide}
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
                      <Link className="sk-btn sk-press" data-variant={st.state === 'now' ? 'primary' : undefined} style={{ marginTop: 8 }} href={st.action.href}>
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

  // ── the month at a glance ─────────────────────────────────────────────
  const cost = o.cost;
  const status = o.run?.status ?? null;
  const needs = o.exceptions.reduce((n, e) => n + e.count, 0);
  const payDay = s ? payDayLabel(year, month, s.pack.payDueDay) : null;
  const earlier = o.recent.filter((r) => !(r.periodYear === year && r.periodMonth === month));

  return (
    <div className="sk-paystack" data-pay-home="month">
      <div className="sk-payhome-top">
        <Card>
          <CardHead>
            <h3>{label}</h3>
            {status ? <RunPill status={status} /> : <span className="sk-pill" data-tone="warn">Not run yet</span>}
          </CardHead>
          <CardBody className="sk-payhero">
            <div className="fig">
              <span className="lab">{cost.estimated ? `What ${monthName(month)} will cost the school` : `What ${monthName(month)} costs the school`}</span>
              <span className="big">{rupees(cost.totalCostMinor)}</span>
              <span className="sub">
                {rupees(cost.netMinor)} to their banks · {rupees(cost.employerCostMinor)} school&rsquo;s own share
                {cost.estimated ? ' · before tax is worked out' : ''}
              </span>
            </div>
            <Figures count={3}>
              <Figure value={cost.headcount.toLocaleString('en-IN')} label="on pay" />
              <Figure value={<span style={{ color: needs ? 'var(--sk-amber-ink)' : undefined }}>{needs}</span>} label={needs === 1 ? 'needs a person' : 'need a person'} />
              <Figure value={payDay ?? '—'} label="pay day" />
            </Figures>
            <div className="sk-payhome-cta">
              <Link className="sk-btn sk-press" data-variant="primary" href={`${base}/month`}>
                {o.run ? `Open ${monthName(month)}` : `Start ${monthName(month)}`}
              </Link>
              {needs > 0 ? <Link className="sk-btn" href={`${base}/${o.exceptions[0].goTo}`}>Fix what needs you</Link> : null}
            </div>
          </CardBody>
        </Card>
        {!open ? <GuidePoster onOpen={showGuide} /> : <GuidePoster onOpen={() => bringIntoView(guideRef.current)} open />}
      </div>

      {guide}

      <HubDoors>
        <HubDoor
          href={`${base}/month`} icon={CalendarCheck} tint="var(--sk-brand)" title="This month"
          meta={`${status ? runWord(status) : 'Not started'}${needs ? ` · ${needs} to fix` : ''}`}
        />
        <HubDoor href={`${base}/people`} icon={Users} tint="var(--sk-ink-2)" title="People" meta={`${o.setup.onPay} on pay${o.setup.notOnPay ? ` · ${o.setup.notOnPay} waiting` : ''}`} />
        <HubDoor href={`${base}/grades`} icon={Layers} tint="var(--sk-amber)" title="Grades" meta={`${o.setup.gradeCount} ${o.setup.gradeCount === 1 ? 'job' : 'jobs'} · bands and splits`} />
        <HubDoor href={`${base}/filings`} icon={FileStack} tint="var(--sk-good)" title="Filings" meta="PF · ESI · the bank file" />
      </HubDoors>

      <HubList
        title="Months paid" label="Months paid"
        more={{ href: `${base}/payslips`, label: 'Payslips' }}
        columns="minmax(0, 1.4fr) minmax(0, 1fr) auto"
        count={earlier.length}
        empty="No month has been paid yet. The first one you lock will show here."
      >
        {earlier.map((r) => (
          <Row key={r.id}>
            <Cell><RowTitle title={`${monthName(r.periodMonth)} ${r.periodYear}`} sub={`${r.headcount} ${r.headcount === 1 ? 'person' : 'people'}`} /></Cell>
            <Cell><span className="sk-num" style={{ fontWeight: 650 }}>{rupees(r.grossMinor + r.employerCostMinor)}</span></Cell>
            <Cell align="end"><RunPill status={r.status} /></Cell>
          </Row>
        ))}
      </HubList>
    </div>
  );
}

/**
 * The guide's poster. A button: pressing it opens the walkthrough right
 * under the top row. `hero` is the wide form used before the first run.
 */
export function GuidePoster({ onOpen, hero, open }: { onOpen: () => void; hero?: boolean; open?: boolean }) {
  return (
    <button type="button" className="sk-payposter" data-hero={hero || undefined} onClick={onOpen} aria-expanded={open ?? false}>
      <span className="play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
      <span className="t">
        <b>How Pay works</b>
        <small>3 minutes · 17 steps · the real screens, walked through</small>
      </span>
      <span className="path">Settings → Grades → People → This month → Payslips → Filings</span>
    </button>
  );
}

/** jsdom has no scrollIntoView; a missing method must never take the page down. */
function bringIntoView(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

const RUN_WORD: Record<string, string> = { DRAFT: 'Draft', CALCULATED: 'Worked out', APPROVED: 'Approved', LOCKED: 'Locked', PAID: 'Paid' };
function runWord(status: string) { return RUN_WORD[status] ?? status; }

/** "7 Nov" — pay for a month is due on the pack's day of the FOLLOWING month. */
export function payDayLabel(year: number, month: number, dueDay: number): string {
  const m = month === 12 ? 1 : month + 1;
  return `${dueDay} ${monthName(m).slice(0, 3)}`;
}
