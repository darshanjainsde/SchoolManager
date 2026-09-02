/**
 * Reopening a saved seating.
 *
 * The hazard this pins is quiet: a saved plan carries the room AS IT WAS, and
 * loading that straight into the room editor means the next "Save changes"
 * writes October's shape back over the room. The chart has to render on the
 * plan's floor while the editor keeps editing the real one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

// Hall A is SIX desks wide today; the saved plan was made when it was nine.
const LIVE_ROOM = {
  id: 'r1', name: 'Hall A', rows: 6, cols: 6, seatsPerDesk: 1,
  removedDesks: [] as string[], capacity: 30, planCount: 1,
};

const SAVED = {
  id: 'p1',
  roomId: 'r1',
  roomName: 'Hall A',
  title: 'Half-Yearly, Day 3',
  classSectionIds: ['c1'],
  rules: { noClassmates: true, alternateCols: true, spreadRolls: true, backRowFree: true },
  seed: 11,
  createdAt: '2026-08-20T09:00:00.000Z',
  room: { rows: 6, cols: 9, seatsPerDesk: 1, removedDesks: [] as string[] },
  seats: [
    { row: 0, seat: 8, desk: 8, code: 'R1·S09', studentId: 's1', studentName: 'Aarav Sharma',
      classSectionId: 'c1', classLabel: 'Class 9-A', roll: 1 },
  ],
  report: { capacity: 45, seated: 1, unseated: 0, clashes: 0, bent: 0, notes: ['All 1 students seated.'] },
};

const CLASSES = [{ id: 'c1', name: 'A', grade: { name: 'Class 9' }, _count: { students: 1 } }];
const PLANS = [{ id: 'p1', roomId: 'r1', roomName: 'Hall A', title: 'Half-Yearly, Day 3',
  classSectionIds: ['c1'], seated: 1, createdAt: SAVED.createdAt }];

const put = vi.fn(async (_path: string, _body: Record<string, unknown>) => LIVE_ROOM);
vi.mock('@/components/use-host', () => ({ useHost: () => 'greenfield.test.sckools.com' }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/use-api', () => ({
  useApi: () => ({
    get: async (path: string) => {
      if (path === '/manage/rooms') return [LIVE_ROOM];
      if (path === '/manage/classes') return CLASSES;
      if (path === '/manage/seating') return PLANS;
      if (path === '/manage/seating/p1') return SAVED;
      throw new Error(`unexpected GET ${path}`);
    },
    post: async () => SAVED,
    put: (path: string, body: Record<string, unknown>) => put(path, body),
    del: async () => ({ ok: true }),
  }),
}));

import ExamHallPage from './page';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

async function openTheSavedPlan() {
  render(wrap(<ExamHallPage />));
  await screen.findByText('Hall A');
  fireEvent.click(screen.getByRole('tab', { name: /What prints/ }));
  // Anchored: the DELETE control is also named with the title
  // ("Delete the saved seating …"), so an unanchored match finds both.
  fireEvent.click(await screen.findByRole('button', { name: /^Half-Yearly, Day 3/ }));
  await waitFor(() => expect(screen.getByTestId('room-moved')).toBeInTheDocument());
}

describe('reopening a saved seating', () => {
  beforeEach(() => put.mockClear());

  it('draws the chart on the room as it WAS, not as it is now', async () => {
    await openTheSavedPlan();
    // Seat 9 exists only in the nine-wide room the plan was saved against.
    expect(screen.getByTestId('cell-0:8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aarav Sharma/ })).toBeInTheDocument();
  });

  it('leaves the room editor on the room as it IS', async () => {
    await openTheSavedPlan();
    fireEvent.click(screen.getByRole('tab', { name: /Your room/ }));
    expect((screen.getByLabelText('Desks in a row') as HTMLInputElement).value).toBe('6');
  });

  it('does not write the old shape back over the room', async () => {
    await openTheSavedPlan();
    fireEvent.click(screen.getByRole('tab', { name: /Your room/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save changes|Save room/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    // The body must carry today's six desks, never the plan's nine.
    expect(put.mock.calls[0][1]).toMatchObject({ cols: 6 });
  });

  it('says plainly that the room has changed since', async () => {
    await openTheSavedPlan();
    expect(screen.getByTestId('room-moved').textContent).toMatch(/changed shape since/);
  });

  it('restores the sitting whole — title, classes and rules', async () => {
    await openTheSavedPlan();
    expect((screen.getByDisplayValue('Half-Yearly, Day 3') as HTMLInputElement)).toBeInTheDocument();
    // Anchored again: a SEAT is also named with its class ("Aarav Sharma, Class 9-A, …").
    expect(screen.getByRole('button', { name: /^Class 9-A/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
