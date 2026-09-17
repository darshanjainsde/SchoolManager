//
// Renders the REAL student-portal Library and Sports views to static HTML so a
// browser can measure them — the same discipline as render.test.tsx. Fixtures
// deliberately carry the longest realistic values, per the ui-mistake-ledger:
// a full Indian name as an opponent, a long title and author, a lakh-scale
// fine is impossible here but a three-figure one is, `4 × 100 m relay` as a
// sport, a team side, a heat with a lane, a finished meet, four houses.
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it, expect } from 'vitest';
import { LibraryView } from '@/app/portal/library/library-view';
import { SportsView } from '@/app/portal/sports/sports-view';
import type { MeLibraryPayload } from '@/lib/library-types';
import type { MeSportsPayload } from '@/lib/sports-me-types';

const shelf: MeLibraryPayload = {
  kind: 'STUDENT', limit: 2, loanDays: 14, finesEnabled: true, today: '2026-09-17',
  rules: { finePerDayRupees: 5, graceDays: 1, lostFeeRupees: 120 },
  holdings: [
    { issueId: 'i1', title: 'The Mysterious Benedict Society and the Perilous Journey', author: 'Trenton Lee Stewart', accessionNo: 'B-004217', issuedOn: '2026-08-20', dueOn: '2026-09-03', daysLeft: -14, accruedFineRupees: 65 },
    { issueId: 'i2', title: 'Wonder', author: 'R. J. Palacio', accessionNo: 'B-000077', issuedOn: '2026-09-15', dueOn: '2026-09-29', daysLeft: 12, accruedFineRupees: 0 },
  ],
  history: [
    { issueId: 'i3', title: 'Harry Potter and the Order of the Phoenix', author: 'J. K. Rowling', returnedOn: '2026-07-28', wasLost: false },
    { issueId: 'i4', title: 'Hatchet', author: 'Gary Paulsen', returnedOn: '2026-07-01', wasLost: true },
    { issueId: 'i5', title: 'Malgudi Days', author: 'R. K. Narayan', returnedOn: '2026-06-12', wasLost: false },
  ],
  fines: [{ id: 'f1', title: 'Hatchet', reason: 'LOST', amountRupees: 120 }],
  finesDueRupees: 185,
};
const emptyShelf: MeLibraryPayload = { ...shelf, holdings: [], history: [], fines: [], finesDueRupees: 0 };

const sideNames = { 's:me': 'Saanvi Krishnamurthy', 's:o': 'Aadhya Venkataraghavan', 's:p': 'Pia Khandelwal', 'c:9-A': '9 A', 'c:9-B': '9 B', 'h:h1': 'Raffles Red', 'h:h2': 'Raffles Blue' };
const sports: MeSportsPayload = {
  role: 'STUDENT', house: { id: 'h1', name: 'Raffles Red', color: '#c4453f' },
  houses: [
    { id: 'h1', name: 'Raffles Red', color: '#c4453f', points: 142, members: 412 },
    { id: 'h2', name: 'Raffles Blue', color: '#2b5bd7', points: 157, members: 408 },
    { id: 'h3', name: 'Raffles Green', color: '#178a5b', points: 142, members: 415 },
    { id: 'h4', name: 'Raffles Yellow', color: '#d99a00', points: 96, members: 410 },
  ],
  tournaments: [
    {
      id: 't1', name: 'Annual Athletics & Games Meet 2026', startsOn: '2026-09-19', endsOn: '2026-09-21', status: 'LIVE', dayStartMin: 540, sideNames,
      events: [
        { eventId: 'e1', tournamentId: 't1', sportName: 'Badminton', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Games', bestOf: 3, to: 21, winBy: 2, cap: 30 }, groupLabel: 'Sub-junior', category: 'Girls', structure: 'CLASS', side: 's:me',
          matches: [
            { id: 'm1', stage: 'CLASS', groupLabel: 'Class 9', roundName: 'Quarter-final', aSide: 's:me', bSide: 's:o', scoreA: [21, 19, 21], scoreB: [15, 21, 18], winner: 's:me', bye: false, walkover: false, venue: 'Court 1', atMin: 600 },
            { id: 'm2', stage: 'CLASS', groupLabel: 'Class 9', roundName: 'Semi-final', aSide: 's:p', bSide: 's:me', scoreA: [], scoreB: [], winner: null, bye: false, walkover: false, venue: 'Court 2', atMin: 1440 + 615 },
          ], heats: [] },
        { eventId: 'e2', tournamentId: 't1', sportName: '4 × 100 m relay', kind: 'MEASURED', scoring: { type: 'MARK', label: 'Time', unit: 's', lowerIsBetter: true, precision: 2 }, groupLabel: 'Senior', category: 'Girls', structure: 'HEATS', side: 'c:9-A',
          matches: [], heats: [
            { id: 'h1', kind: 'HEAT', idx: 2, venue: 'Track', atMin: 700, done: true, lane: 5, mark: 54.31, rank: 2 },
            { id: 'h2', kind: 'FINAL', idx: 6, venue: 'Track', atMin: 2 * 1440 + 900, done: false, lane: 3, mark: null, rank: null },
          ] },
        { eventId: 'e3', tournamentId: 't1', sportName: 'Chess', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Games', bestOf: 1, to: 1, winBy: 1, cap: 1 }, groupLabel: 'Sub-junior', category: 'Girls', structure: 'CLASS', side: 's:me',
          matches: [{ id: 'm3', stage: 'CLASS', groupLabel: 'Class 9', roundName: 'Round of 16', aSide: 's:me', bSide: null, scoreA: [], scoreB: [], winner: null, bye: true, walkover: false, venue: null, atMin: null }], heats: [] },
      ],
    },
    {
      id: 't0', name: 'Inter-house Kabaddi Cup', startsOn: '2026-08-09', endsOn: '2026-08-09', status: 'DONE', dayStartMin: 540, sideNames,
      events: [{ eventId: 'e0', tournamentId: 't0', sportName: 'Kabaddi', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Points', bestOf: 1, to: 0, winBy: 0, cap: 0 }, groupLabel: 'Senior', category: 'Girls', structure: 'HOUSE', side: 'h:h1',
        matches: [{ id: 'm0', stage: 'HOUSE', groupLabel: 'Final', roundName: 'Final', aSide: 'h:h1', bSide: 'h:h2', scoreA: [34], scoreB: [41], winner: 'h:h2', bye: false, walkover: false, venue: 'Main field', atMin: 900 }], heats: [] }],
    },
  ],
  records: {
    records: [{ id: 'r1', sportName: '100 m sprint', groupKey: 'sub', category: 'Girls', text: '13.10 s', holderName: 'Saanvi Krishnamurthy', sinceYear: 2025, untilYear: null, status: 'STANDING' }],
    attempts: [{ id: 'a1', sportName: 'Long jump', groupKey: 'sub', category: 'Girls', text: '4.62 m', status: 'PENDING', source: 'MEET', createdAt: '2026-09-17' }],
  },
};
const noEntries: MeSportsPayload = { role: 'STUDENT', house: null, houses: [], tournaments: [], records: { records: [], attempts: [] } };
const teacher: MeSportsPayload = { role: 'TEACHER', tournaments: [{ id: 't1', name: 'Annual Athletics & Games Meet 2026', startsOn: '2026-09-19', endsOn: '2026-09-21', status: 'LIVE' }], houses: sports.role === 'STUDENT' ? sports.houses : [] };

it('writes the real student-portal screens for a browser to measure', () => {
  const panels: [string, React.ReactNode][] = [
    ['Library — two out, one late, a lost fine', <LibraryView d={shelf} />],
    ['Library — nothing out', <LibraryView d={emptyShelf} />],
    ['Sports — a live meet, a finished one, four houses', <SportsView d={sports} />],
    ['Sports — not entered', <SportsView d={noEntries} />],
    ['Sports — teacher', <SportsView d={teacher} />],
  ];
  // Each panel sits inside the portal's own <main class="sk-main">, so the
  // shell's width and padding are the ones being measured.
  const body = panels.map(([name, node]) =>
    `<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2><main class="sk-main">${renderToStaticMarkup(node)}</main></section>`).join('\n');
  const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');
  writeFileSync(resolve(process.cwd(), 'audit/screens-portal.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<style>body{margin:0;padding:0;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0;padding:10px 20px 0}</style>
</head><body class="skosx sk-shell">${body}</body></html>`);
  console.log(`wrote audit/screens-portal.html — ${body.length} bytes of real component markup`);
  expect(body.length).toBeGreaterThan(5000);
});
