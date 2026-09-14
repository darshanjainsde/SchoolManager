import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import PortalSportsPage from './page';
import type { MeSportsPayload } from '@/lib/sports-me-types';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(payload: MeSportsPayload | Error): ApiStub {
  const api: ApiStub = { get: vi.fn(() => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload))), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
  vi.mocked(useApi).mockReturnValue(api as never);
  return api;
}
beforeEach(() => vi.mocked(useHost).mockReturnValue('raffles.test.sckools.com'));

const student: MeSportsPayload = {
  role: 'STUDENT', house: { id: 'h', name: 'Red', color: '#f00' },
  tournaments: [{
    id: 't', name: 'Annual meet', startsOn: '2026-09-15', endsOn: '2026-09-16', status: 'LIVE', dayStartMin: 540, sideNames: { 's:me': 'Meera I', 's:o': 'Zoya R', 's:p': 'Pia K' },
    events: [
      { eventId: 'e1', tournamentId: 't', sportName: 'Badminton', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Games', bestOf: 3, to: 21, winBy: 2, cap: 30 }, groupLabel: 'Senior', category: 'Girls', structure: 'CLASS', side: 's:me',
        matches: [
          { id: 'm1', stage: 'CLASS', groupLabel: 'Class 9', roundName: 'Semi-final', aSide: 's:me', bSide: 's:o', scoreA: [21, 21], scoreB: [15, 19], winner: 's:me', bye: false, walkover: false, venue: 'Court 1', atMin: 600 },
          { id: 'm2', stage: 'CLASS', groupLabel: 'Class 9', roundName: 'Final', aSide: 's:p', bSide: 's:me', scoreA: [], scoreB: [], winner: null, bye: false, walkover: false, venue: 'Court 2', atMin: 1440 + 615 },
        ], heats: [] },
      { eventId: 'e2', tournamentId: 't', sportName: '100 m sprint', kind: 'MEASURED', scoring: { type: 'MARK', label: 'Time', unit: 's', lowerIsBetter: true, precision: 2 }, groupLabel: 'Senior', category: 'Girls', structure: 'HEATS', side: 's:me',
        matches: [], heats: [{ id: 'h1', kind: 'HEAT', idx: 1, venue: 'Track', atMin: 700, done: true, lane: 3, mark: 13.2, rank: 2 }] },
    ],
  }],
  records: { records: [{ id: 'r', sportName: '100 m sprint', groupKey: 'sen', category: 'Girls', text: '13.10 s', holderName: 'Meera I', sinceYear: 2025, untilYear: null, status: 'STANDING' }], attempts: [] },
};

describe('PortalSportsPage', () => {
  it('a student sees what is next first, then results, their house and their records', async () => {
    mockApi(student);
    renderWithProviders(<PortalSportsPage />);
    expect(await screen.findByText('Up next')).toBeInTheDocument();
    expect(screen.getByText(/Final \(Class 9\) v Pia K/)).toBeInTheDocument();
    expect(screen.getByText('Wed 16 Sep, 10:15 · Court 2')).toBeInTheDocument();
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText(/Semi-final \(Class 9\) v Zoya R 21-15 21-19/)).toBeInTheDocument();
    expect(screen.getByText('2nd')).toBeInTheDocument();
    expect(screen.getByText('Heat 2: 13.20 s')).toBeInTheDocument();
    expect(screen.getByText('Red house')).toBeInTheDocument();
    expect(screen.getByText('School record since 2025')).toBeInTheDocument();
  });

  it('a teacher sees the published meets and the house table', async () => {
    mockApi({ role: 'TEACHER', tournaments: [{ id: 't', name: 'Annual meet', startsOn: '2026-09-15', endsOn: '2026-09-15', status: 'LIVE' }], houses: [{ id: 'h', name: 'Blue', color: '#00f', points: 42, members: 120 }] });
    renderWithProviders(<PortalSportsPage />);
    expect(await screen.findByText('Annual meet')).toBeInTheDocument();
    expect(screen.getByText('Blue')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('a plan without sports says so instead of erroring; an empty entry list explains itself', async () => {
    mockApi(new ApiError(403, 'forbidden', { code: 'FEATURE_OFF' }));
    renderWithProviders(<PortalSportsPage />);
    expect(await screen.findByText(/isn.t part of your school.s plan/)).toBeInTheDocument();
    mockApi({ role: 'STUDENT', house: null, tournaments: [], records: { records: [], attempts: [] } });
    renderWithProviders(<PortalSportsPage />);
    expect(await screen.findByText(/not entered in a tournament yet/)).toBeInTheDocument();
  });
});
