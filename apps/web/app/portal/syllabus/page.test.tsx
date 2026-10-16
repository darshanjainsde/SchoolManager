import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { STUDENT_HOME } from '@/test/fixtures/syllabus';
import Page from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const mockApi = (get: (p: string) => Promise<unknown>) => ({ get: vi.fn(get), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() });

describe('student syllabus home', () => {
  beforeEach(() => { vi.mocked(useHost).mockReturnValue('raffles.sckools.com'); });

  it('one card per subject with taught vs revised rings, and the count to revise', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async () => STUDENT_HOME) as never);
    renderWithProviders(<Page />);
    const maths = await screen.findByTestId('syl-subject-s-mat');
    expect(maths).toHaveAttribute('href', '/portal/syllabus/s-mat');
    expect(maths.querySelector('svg')).toHaveAttribute('aria-label', 'Taught 42%, Revised by me 17%');
    expect(maths).toHaveTextContent('5 of 12 taught · 2 revised');
    expect(maths).toHaveTextContent('Now: Coordinate geometry');
    expect(screen.getByTestId('syl-subject-s-sci')).toHaveTextContent('Teacher not on the timetable');
    expect(screen.getByText('Class 9-A · 2026-27 · 3 taught topics to revise')).toBeInTheDocument();
  });

  it('no class yet, no chapters yet, and the feature off each say so', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async () => ({ className: null, year: null, subjects: [] })) as never);
    let r = renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-no-class')).toBeInTheDocument();
    r.unmount();
    vi.mocked(useApi).mockReturnValue(mockApi(async () => ({ ...STUDENT_HOME, subjects: [] })) as never);
    r = renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-no-subjects')).toBeInTheDocument();
    r.unmount();
    vi.mocked(useApi).mockReturnValue(mockApi(async () => { throw new ApiError(403, 'nope', {}); }) as never);
    renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-not-in-plan')).toBeInTheDocument();
  });
});
