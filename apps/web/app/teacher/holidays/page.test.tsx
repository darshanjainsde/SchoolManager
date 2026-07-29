import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { Holiday } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherHolidaysPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function holiday(overrides: Partial<Holiday> = {}): Holiday {
  return {
    id: 'h-1',
    name: 'Founders Day',
    type: 'SCHOOL',
    startDate: '2026-08-15T00:00:00.000Z',
    endDate: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherHolidaysPage', () => {
  it('renders a loading state while the request is in flight', () => {
    let resolve!: (v: Holiday[]) => void;
    const pending = new Promise<Holiday[]>((r) => {
      resolve = r;
    });
    const api = mockApi({ get: vi.fn().mockReturnValue(pending) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherHolidaysPage />);

    expect(screen.getByText('Loading holidays…')).toBeInTheDocument();
    resolve([]);
  });

  it('renders the server error message on failure', async () => {
    const api = mockApi({ get: vi.fn().mockRejectedValue(new Error('Holidays service is unavailable')) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherHolidaysPage />);

    expect(await screen.findByText('Holidays service is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No upcoming holidays.')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading holidays…')).not.toBeInTheDocument();
  });

  it('renders the explicit empty state on an empty list', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue([]) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherHolidaysPage />);

    expect(await screen.findByText('No upcoming holidays.')).toBeInTheDocument();
    expect(screen.queryByText('Loading holidays…')).not.toBeInTheDocument();
  });

  it('fetches /me/holidays and renders what it returns', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue([holiday({ name: 'Founders Day' })]) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherHolidaysPage />);

    expect(await screen.findByText('Founders Day')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/me/holidays');
  });
});
