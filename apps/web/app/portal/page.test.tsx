import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import PortalHome from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

/**
 * The portal home fires six or seven independent queries. These tests care
 * about exactly one of them, so everything else answers with the empty shape
 * its card expects — a stub that threw for unlisted paths would make this
 * file fail every time an unrelated card is added.
 */
function stubWithDiary(unsignedCount: number): ApiStub {
  return {
    get: vi.fn((path: string) => {
      // `entries`, matching StudentDiaryResult. The stub said `days`, which the
      // banner happened not to read — a stub that disagrees with the contract
      // still passes today and lies to whoever extends it tomorrow.
      if (path.startsWith('/me/diary')) return Promise.resolve({ entries: [], unsignedCount });
      if (path.startsWith('/me/profile'))
        return Promise.resolve({ firstName: 'Asha', lastName: 'Rao', className: '8-A', rollNo: 3 });
      if (path.startsWith('/me/attendance'))
        return Promise.resolve({ month: '2026-08', present: 0, absent: 0, late: 0, percent: 0, days: [] });
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
