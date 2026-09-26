//
// THE SHELLS EVERY STAFF PORTAL IS BUILT FROM — measured, not eyeballed.
//
// The owner reported four things on the teacher portal, and all four were one
// level below the page: the subtitle sitting BESIDE the title instead of under
// it, a row of figures stopping a quarter short of the card beneath it, and a
// wide band of dead space down the right of every tab. None of them belongs to
// a screen — they belong to `.sk-pagehead`, `.sk-kpis` and the content column,
// which is why they appeared on every tab at once and on other portals too.
//
// So this file renders those shells in every shape the product actually uses,
// with the longest realistic strings (ui-mistake-ledger: judge a control at the
// value the real data reaches, not the fixture's), and `measure.html` reports
// overflow, clipping, tap targets and ragged rows per width.
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { it, expect } from 'vitest';
import { HubPage, HubKpis, HubKpi, HubList } from '@/components/ui/hub';
import { Cell, Row, RowTitle } from '@/components/ui/kit';

/** The page head exactly as 25+ pages write it: h1 and p as direct children. */
const BareHead = ({ title, subtitle, action }: { title: string; subtitle: string; action?: boolean }) => (
  <header className="sk-pagehead">
    <h1>{title}</h1>
    <p>{subtitle}</p>
    {action ? <button type="button" className="sk-btn sk-btn-primary">Post an announcement</button> : null}
  </header>
);

/** And as the other pages write it, wrapped in a div. Both must look the same. */
const WrappedHead = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <header className="sk-pagehead">
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  </header>
);

/** Rows as the kit really takes them: the LIST owns the tracks, never a row. */
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    <Row key={i} testId={`r${i}`}>
      <RowTitle
        title={i === 0 ? 'Mohammed Irfan Qureshi' : 'Saanvi Krishnamurthy'}
        sub="Class 8 B · guardian Balasubramanian"
      />
      <Cell>{i === 0 ? '4 × 100 m relay Senior Girls' : 'Mathematics'}</Cell>
      <Cell align="end">₹ 12,81,450</Cell>
    </Row>
  ));

const COLS = 'minmax(0,1fr) minmax(0,140px) auto';

it('writes the staff-portal shells for a browser to measure', () => {
  const panels: [string, React.ReactNode][] = [
    // The exact head that shipped broken, with the longest subtitle in the product.
    ['Head — bare h1+p (teacher Holidays)', <BareHead title="Holidays" subtitle="Upcoming school holidays, set by your school admin." />],
    ['Head — bare h1+p, long subtitle (teacher Assignments)', <BareHead title="Assignments" subtitle="Set homework for a class, attach a worksheet, and see who has opened it." />],
    ['Head — bare h1+p + an action on the same line', <BareHead title="Announcements" subtitle="Everything you have sent to your classes this term, newest first." action />],
    ['Head — wrapped in a div (Complaint Box)', <WrappedHead title="Complaint Box" subtitle="What the families of your class raised with you. Opening one marks it read; you can answer, or send it to the office." />],
    ['Head — a title long enough to wrap on a phone', <BareHead title="Reports &amp; Documents" subtitle="Certificates, transfer certificates and the print register, all in one place." />],

    // The figure row at every count the product uses. Three used to leave a
    // quarter of the row empty against the card below it.
    ['Figures — 2 (Class teachers)', (
      <HubPage title="Class teachers" subtitle="Who owns each section this session.">
        <HubKpis><HubKpi label="Assigned" value={12} hint="of 14" /><HubKpi label="Nobody yet" value={2} hint="these classes have no class teacher" tone="bad" /></HubKpis>
        <HubList title="Classes" label="Classes" columns={COLS} count={3} empty="Nothing yet.">{rows(3)}</HubList>
      </HubPage>
    )],
    ['Figures — 3 (Complaint Box)', (
      <HubPage title="Complaint Box" subtitle="What the families of your class raised with you.">
        <HubKpis><HubKpi label="Unread" value={0} hint="nothing waiting on you" /><HubKpi label="Open" value={0} hint="with you" /><HubKpi label="Resolved this month" value={0} hint="nothing resolved yet" /></HubKpis>
        <HubList title="Open" label="Open concerns" columns={COLS} count={0} empty="Nothing open. A family of your class can write to you from the app.">{rows(0)}</HubList>
      </HubPage>
    )],
    ['Figures — 4 (Fees)', (
      <HubPage title="Fees" subtitle="Billing, collection and what each family owes.">
        <HubKpis><HubKpi label="Billed" value="₹ 12,81,450" /><HubKpi label="Collected" value="₹ 10,86,000" tone="good" /><HubKpi label="Outstanding" value="₹ 1,95,450" tone="warn" /><HubKpi label="Families owing" value={73} hint="at least one unpaid invoice" tone="bad" /></HubKpis>
        <HubList title="Families" label="Families" columns={COLS} count={3} empty="Nothing yet.">{rows(3)}</HubList>
      </HubPage>
    )],
  ];

  // Each panel sits in the teacher portal's own column, so the shell width and
  // padding under measurement are the ones a teacher actually gets.
  const body = panels.map(([name, node]) =>
    `<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2><div class="sk-app"><main class="sk-content">${renderToStaticMarkup(node)}</main></div></section>`).join('\n');

  writeFileSync(resolve(process.cwd(), 'audit/screens-shells.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0;padding:0;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0;padding:10px 20px 0}</style>
</head><body class="skosx sk-shell">${body}</body></html>`);
  console.log(`wrote audit/screens-shells.html — ${body.length} bytes of real component markup`);
  expect(body.length).toBeGreaterThan(5000);
});
