import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { OVERVIEW, YEAR, track } from '@/test/fixtures/syllabus';
import Page from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const mockApi = (get: (p: string) => Promise<unknown>) => ({ get: vi.fn(get), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() });

describe('teacher syllabus list', () => {
  beforeEach(() => { vi.mocked(useHost).mockReturnValue('raffles.sckools.com'); });

  it('one card per class and subject, with rings, the verdict and where the class is', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async () => ({ year: YEAR, tracks: [track({ isClassTeacher: true }), OVERVIEW.tracks[2]] })) as never);
    renderWithProviders(<Page />);
    const card = await screen.findByTestId('syl-track-cs-9a-s-mat');
    expect(card).toHaveAttribute('href', '/teacher/syllabus/cs-9a/s-mat');
    expect(card).toHaveTextContent('Class 9-A · Mathematics');
    expect(card).toHaveTextContent('Slightly behind');
    expect(card).toHaveTextContent('Class teacher');
    expect(card).toHaveTextContent('Now: Coordinate geometry');
    expect(card.querySelector('svg')).toHaveAttribute('aria-label', 'Taught 42%, Expected by today 55%');
    expect(screen.getByText('2026-27 · 55% of working days gone · 1 of 2 behind')).toBeInTheDocument();
  });

  it('says why the list is empty: no session, or not on any timetable', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async () => ({ year: null, tracks: [] })) as never);
    const { unmount } = renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-no-year')).toBeInTheDocument();
    unmount();
    vi.mocked(useApi).mockReturnValue(mockApi(async () => ({ year: YEAR, tracks: [] })) as never);
    renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-no-tracks')).toBeInTheDocument();
  });

  it('a 403 is the plan message; anything else is an error with a retry', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async () => { throw new ApiError(403, 'nope', {}); }) as never);
    const { unmount } = renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-not-in-plan')).toBeInTheDocument();
    unmount();
    vi.mocked(useApi).mockReturnValue(mockApi(async () => { throw new ApiError(500, 'boom', {}); }) as never);
    renderWithProviders(<Page />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
