import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import PortalHome from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

/**
 * The portal home asks ONE question now — GET /me/home — where it used to fire
 * seven. These tests care about one field of that answer, so the rest comes
 * back in the empty shape its card expects; a stub that threw for anything
 * unlisted would fail this file every time an unrelated card was added.
 *
 * Every key below is a field of the shared `PortalHome` contract, and the
 * shapes match the ones the individual routes return — `entries` for the diary,
 * not `days`. A stub that disagrees with the contract still passes today and
 * lies to whoever extends it tomorrow.
 */
function stubWithDiary(unsignedCount: number): ApiStub {
  return {
    get: vi.fn((path: string) => {
      if (path.startsWith('/me/home')) {
        return Promise.resolve({
          profile: { firstName: 'Asha', lastName: 'Rao', className: '8-A', rollNo: 3 },
          timetable: [],
          announcements: [],
          attendance: { month: '2026-08', present: 0, absent: 0, late: 0, percent: 0, days: [] },
          exams: [],
          results: [],
          diary: { entries: [], unsignedCount },
        });
      }
      return Promise.resolve([]);
    }),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  } as unknown as ApiStub;
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

describe('the unsigned-remark banner', () => {
  it('asks for the signature on the home page, the way the app does', async () => {
    // A remark waiting on a signature is the only thing this portal asks OF
    // the family. It used to be visible only after opening Diary, so the same
    // family learned about it on their phone and not on their laptop.
    vi.mocked(useApi).mockReturnValue(stubWithDiary(2) as never);
    renderWithProviders(<PortalHome />);

    const banner = await screen.findByTestId('diary-banner');
    expect(banner).toHaveTextContent('2 diary remarks to sign');
    expect(banner).toHaveAttribute('href', '/portal/diary');
  });

  it('says "A diary remark" rather than "1 diary remarks"', async () => {
    vi.mocked(useApi).mockReturnValue(stubWithDiary(1) as never);
    renderWithProviders(<PortalHome />);

    expect(await screen.findByTestId('diary-banner')).toHaveTextContent('A diary remark to sign');
  });

  it('is absent entirely when nothing is outstanding, so it never becomes furniture', async () => {
    vi.mocked(useApi).mockReturnValue(stubWithDiary(0) as never);
    renderWithProviders(<PortalHome />);

    // Waited on a sibling that always renders, so this is a real absence
    // rather than an assertion that ran before the query resolved.
    await screen.findByText(/Asha/);
    expect(screen.queryByTestId('diary-banner')).not.toBeInTheDocument();
  });
});

describe('the home screen costs one request', () => {
  /**
   * It used to fire seven — profile, timetable, announcements, attendance,
   * exams, results, diary — every time a family opened the portal. On the API
   * each resolved the student in one tenant transaction and fetched its data in
   * another, so one page view cost about fourteen, on the highest-traffic
   * screen in the product.
   */
  it('asks /me/home and nothing else', async () => {
    const stub = stubWithDiary(0);
    vi.mocked(useApi).mockReturnValue(stub as never);
    renderWithProviders(<PortalHome />);
    await screen.findByText(/Asha/);

    const paths = vi.mocked(stub.get).mock.calls.map((c) => String(c[0]));
    expect(paths.filter((p) => p.startsWith('/me/home'))).toHaveLength(1);
    // None of the seven it replaced.
    for (const gone of ['/me/profile', '/me/timetable', '/me/announcements', '/me/attendance', '/me/exams', '/me/results', '/me/diary']) {
      expect(paths.filter((p) => p.startsWith(gone))).toHaveLength(0);
    }
  });

  it('carries the month, so attendance means the month on screen', async () => {
    const stub = stubWithDiary(0);
    vi.mocked(useApi).mockReturnValue(stub as never);
    renderWithProviders(<PortalHome />);
    await screen.findByText(/Asha/);

    const home = vi.mocked(stub.get).mock.calls.map((c) => String(c[0])).find((p) => p.startsWith('/me/home'));
    expect(home).toMatch(/\/me\/home\?month=\d{4}-\d{2}$/);
  });
});

describe('an API older than this build still works', () => {
  /**
   * Web and API deploy from the same push but not at the same speed, and the
   * web is usually first. Observed on staging: /portal was live and calling
   * /me/home while the API still answered 404 to it. On production that window
   * would be every family's home screen showing an error.
   */
  function stubWithout404Home(): ApiStub {
    const get = vi.fn((path: string) => {
      if (path.startsWith('/me/home')) {
        return Promise.reject(new ApiError(404, 'Cannot GET /me/home', null));
      }
      if (path.startsWith('/me/profile'))
        return Promise.resolve({ firstName: 'Asha', lastName: 'Rao', className: '8-A', rollNo: 3 });
      if (path.startsWith('/me/attendance'))
        return Promise.resolve({ month: '2026-08', present: 0, absent: 0, late: 0, percent: 0, days: [] });
      if (path.startsWith('/me/diary')) return Promise.resolve({ entries: [], unsignedCount: 4 });
      return Promise.resolve([]);
    });
    return { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } as unknown as ApiStub;
  }

  it('falls back to the seven routes when /me/home is not there yet', async () => {
    const stub = stubWithout404Home();
    vi.mocked(useApi).mockReturnValue(stub as never);
    renderWithProviders(<PortalHome />);

    // The page renders normally — the family never sees the difference.
    expect(await screen.findByTestId('diary-banner')).toHaveTextContent('4 diary remarks to sign');
    await screen.findByText(/Asha/);

    const paths = vi.mocked(stub.get).mock.calls.map((c) => String(c[0]));
    for (const route of ['/me/profile', '/me/timetable', '/me/announcements', '/me/attendance', '/me/exams', '/me/results', '/me/diary']) {
      expect(paths.some((p) => p.startsWith(route)), `should have asked ${route}`).toBe(true);
    }
  });

  it('does NOT swallow a real failure', async () => {
    // A 500 or a network error must stay an error. A fallback that caught those
    // would turn one outage into seven and hide it.
    const get = vi.fn((path: string) =>
      path.startsWith('/me/home')
        ? Promise.reject(new ApiError(500, 'Internal Server Error', null))
        : Promise.resolve([]),
    );
    vi.mocked(useApi).mockReturnValue({ get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } as never);
    renderWithProviders(<PortalHome />);

    // Surfaced — in both sections, which now share one error state.
    expect(await screen.findAllByText(/Internal Server Error/)).not.toHaveLength(0);
    // None of the seven were tried.
    const paths = get.mock.calls.map((c) => String(c[0]));
    expect(paths.filter((p) => p.startsWith('/me/profile'))).toHaveLength(0);
  });
});
