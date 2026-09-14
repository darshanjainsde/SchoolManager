//
// Renders the REAL sports components to static HTML so a browser can measure
// them. Hand-written harness markup was the weak link in every previous
// responsiveness pass — it can drift from what the app actually emits, and a
// layout audit against markup nobody ships proves nothing.
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Programme } from '@/components/sports/programme';
import { Timetable } from '@/components/sports/timetable';
import { PlanBoard } from '@/components/sports/plan-board';
import { NextUp, stepsOf } from '@/components/sports/next-up';
import { DayPicker } from '@/components/sports/day-picker';
import { Bracket } from '@/components/sports/bracket';
import { HeatSheet } from '@/components/sports/heat-sheet';
import { ScoreBox } from '@/components/sports/score-box';
import { CostLine } from '@/app/app/sports/cost-line';
import { clashesOf, dayIndexOf } from '@/components/sports/model';
import type { EventDetail, MatchRow, TournamentDetail } from '@/app/app/sports/ui';

const VENUES = [
  { id: 'v1', name: 'Court 1', order: 0 }, { id: 'v2', name: 'Court 2', order: 1 },
  { id: 'v3', name: 'Track', order: 2 }, { id: 'v4', name: 'Main field', order: 3 },
  { id: 'v5', name: 'Pool', order: 4 }, { id: 'v6', name: 'Board', order: 5 },
];
/** Longest realistic values, per the ledger: full Indian names, long sports. */
const NAMES = ['Saanvi Krishnamurthy', 'Aadhya Venkataraghavan', 'Aarav Mehta', 'Kabir Bhat'];
const sideNames: Record<string, string> = {};
NAMES.forEach((n, i) => { sideNames[`s:k${i}`] = n; });

const match = (o: Partial<MatchRow>): MatchRow => ({
  id: 'm', stage: 'CLASS', groupLabel: 'Class 9', roundIdx: 0, roundName: 'Round of 16', pos: 0,
  aSide: 's:k0', bSide: 's:k1', scoreA: [], scoreB: [], winner: null, bye: false, walkover: false,
  venueId: 'v1', atMin: 540, version: 1, savedAt: null, ...o,
});
const ev = (o: Partial<EventDetail>): EventDetail => ({
  id: 'e1', sportKey: 'ath-4x100', sportName: '4 × 100 m relay', kind: 'MATCH',
  scoring: { type: 'GAMES', label: 'Games', bestOf: 3, to: 21, winBy: 2, cap: 30 },
  teamSize: 1, groupKey: 'sen', groupLabel: 'Sub-junior', category: 'Girls', structure: 'CLASS',
  teamBasis: 'SECTIONS', stageShape: 'CLASS_QUAL', advancePerClass: 2, finalists: 6, dayIdx: null,
  slotMin: 25, lanes: 6, venueIds: ['v1', 'v2'], order: 0,
  entries: NAMES.map((_, i) => ({ studentId: `k${i}`, side: `s:k${i}`, std: 9, section: 'A', houseId: null })),
  matches: [], heats: [], ...o,
});

const bigDraw = Array.from({ length: 16 }, (_, i) =>
  match({ id: `m${i}`, pos: i, atMin: 540 + i * 25, venueId: i % 2 ? 'v2' : 'v1', bye: i % 3 === 0 }));
const rounds2 = Array.from({ length: 8 }, (_, i) =>
  match({ id: `r2-${i}`, roundIdx: 1, roundName: 'Quarter-final', pos: i, aSide: null, bSide: null, atMin: 960 + i * 25 }));

const T: TournamentDetail = {
  id: 't1', name: 'Annual Sports Meet 2026', startsOn: '2026-09-13', endsOn: '2026-09-14',
  grouping: 'BANDS', dayStartMin: 540, dayEndMin: 960, restMin: 15, gapMin: 5,
  status: 'DRAFT', published: false, version: 1, venues: VENUES,
  events: [
  ev({ matches: [...bigDraw, ...rounds2] }),
  ev({
    id: 'e2', sportKey: 'ath-100m', sportName: '100 m sprint', kind: 'MEASURED', groupLabel: 'Senior', category: 'Boys',
    venueIds: ['v3'], slotMin: 5,
    heats: Array.from({ length: 14 }, (_, i) => ({
      id: `h${i}`, kind: i === 13 ? 'FINAL' as const : 'HEAT' as const, groupLabel: i < 7 ? 'Class 9' : 'Class 10',
      idx: i, venueId: 'v3', atMin: 540 + i * 10, done: i < 3,
      marks: NAMES.map((_, j) => ({ studentId: `k${j}`, side: `s:k${j}`, lane: j + 1, mark: i < 3 ? 13.4 : null, rank: i < 3 ? j + 1 : null })),
    })),
  }),
  ev({ id: 'e3', sportKey: 'chess', sportName: 'Chess', venueIds: [], matches: [] }),
  ],
  sideNames, bands: [],
};

const noop = () => {};
const planActs = { update: noop, addVenue: noop, removeVenue: noop, pin: noop, refit: noop };
const progActs = { moveGroup: noop, hold: noop };
const ttActs = { move: noop, clearVenue: noop, refuse: noop };
const wizard = {
  name: 'Annual Sports Meet 2026', startsOn: '2026-09-13', endsOn: '2026-09-13',
  dayStartMin: 540, dayEndMin: 600, restMin: 15, gapMin: 5,
  venues: [{ name: 'Court 1', type: 'court' as const }],
  defaults: { groupKey: 'sen', categories: ['Boys' as const], structure: 'CLASS' as const, stageShape: 'CLASS_QUAL' as const },
  events: [],
};

import { it, expect } from 'vitest';

it('writes the real screens for a browser to measure', () => {
  const clashes = clashesOf(T);
  const panels: [string, React.ReactNode][] = [
    ['Where this meet is', <NextUp steps={stepsOf(T, clashes.length)} onGo={noop} />],
    ['Programme', <Programme t={T} canEdit busy={false} act={progActs} onOpen={noop} />],
    ['Day picker', <DayPicker startsOn={T.startsOn} days={dayIndexOf(T)} day={0} onDay={noop} />],
    ['Timetable', <Timetable t={T} day={0} clashes={clashes} canEdit busy={false} act={ttActs} onOpen={noop} />],
    ['Days & courts', <PlanBoard t={T} canEdit busy={false} act={planActs} onOpenDay={noop} />],
    ['Bracket', <Bracket t={T} event={T.events[0]} selectedId={null} canScore onSelect={noop} />],
    ['Heat sheet', <HeatSheet t={T} heat={T.events[1].heats[3]} scoring={{ type: 'MARK', label: 'Time', unit: 's', lowerIsBetter: true, precision: 2 }} canEnter live={false} />],
    ['Score box', <ScoreBox t={T} m={T.events[0].matches[1]} scoring={T.events[0].scoring} onClose={noop} />],
    ['Cost line', <CostLine state={wizard as never} roster={NAMES.map((n, i) => ({ id: `k${i}`, name: n, std: 9, section: 'A', gender: 'M', dob: '2011-01-01', houseId: null }))} patch={noop} />],
  ];
  const body = panels.map(([name, node]) =>
    `<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>,
    )}</section>`).join('\n');
  const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');
  writeFileSync(resolve(process.cwd(), 'audit/screens.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<style>body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body class="skosx"><div class="sk-sp-stack">${body}</div></body></html>`);
  console.log(`wrote audit/screens.html — ${body.length} bytes of real component markup`);
  expect(body.length).toBeGreaterThan(5000);
});
