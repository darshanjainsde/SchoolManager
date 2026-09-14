import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import StudentsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  email: string | null;
  classSectionId: string | null;
  rollNo: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  photoAssetId: string | null;
  classSection: { name: string; grade: { name: string } } | null;
  userId: string | null;
  status: 'ACTIVE' | 'ALUMNI' | 'TRANSFERRED' | 'LEFT';
  leftOn: string | null;
  alumniBatch: string | null;
}

function student(overrides: Partial<StudentRow>): StudentRow {
  return {
    id: 's-1',
    admissionNo: 'ADM-001',
    firstName: 'Rahul',
    lastName: 'Verma',
    email: null,
    classSectionId: null,
    rollNo: null,
    guardianName: null,
    guardianPhone: null,
    photoAssetId: null,
    classSection: null,
    userId: null,
    status: 'ACTIVE',
    leftOn: null,
    alumniBatch: null,
    ...overrides,
  };
}

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('StudentsPage avatars', () => {
  it('renders a photo for a student whose photoAssetId resolves via /site/media?kind=AVATAR, and initials otherwise', async () => {
    const get = vi.fn((path: string) => {
      if (path.startsWith('/manage/classes')) return Promise.resolve([]);
      if (path.startsWith('/manage/students')) {
        return Promise.resolve([
          student({ id: 's-1', admissionNo: 'ADM-001', firstName: 'Rahul', lastName: 'Verma', photoAssetId: 'asset-1' }),
          student({ id: 's-2', admissionNo: 'ADM-002', firstName: 'Meera', lastName: 'Shah', photoAssetId: null }),
        ]);
      }
      if (path.startsWith('/site/media')) {
        return Promise.resolve([{ id: 'asset-1', url: 'https://cdn.example.com/rahul.jpg' }]);
      }
      return Promise.resolve([]);
    });
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get as ApiStub['get'] }) as never);

    renderWithProviders(<StudentsPage />);

    // Self-uploaded avatars are kind AVATAR — the map must come from that list.
    const img = await screen.findByAltText('Rahul Verma');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/rahul.jpg');
    expect(get).toHaveBeenCalledWith('/site/media?kind=AVATAR');

    // No photoAssetId → initials fallback, never a broken <img>.
    expect(screen.getByText('MS')).toBeInTheDocument();
    expect(screen.queryByAltText('Meera Shah')).not.toBeInTheDocument();
  });

  it('falls back to initials (not a broken image) when the asset list has no entry for the id', async () => {
    const get = vi.fn((path: string) => {
      if (path.startsWith('/manage/students')) {
        return Promise.resolve([
          student({ id: 's-1', firstName: 'Rahul', lastName: 'Verma', photoAssetId: 'asset-gone' }),
        ]);
      }
      return Promise.resolve([]);
    });
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get as ApiStub['get'] }) as never);

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText('Rahul Verma')).toBeInTheDocument();
    expect(screen.getByText('RV')).toBeInTheDocument();
    expect(screen.queryByAltText('Rahul Verma')).not.toBeInTheDocument();
  });
});

/**
 * THE ROW-HEIGHT GUARD.
 *
 * The Portal login cell stacked a status pill ABOVE a full-size "Resend
 * invite" button, so every row was roughly two lines — eight hundred children
 * became a table you scroll for a minute to reach the letter S. The state and
 * the one action that changes it now sit on one line, with the action at icon
 * size and its label on `aria-label` rather than in the flow.
 */
describe('a student is one line', () => {
  function get3() {
    return vi.fn((path: string) => {
      if (path.startsWith('/manage/classes')) return Promise.resolve([]);
      if (path.startsWith('/manage/students')) {
        return Promise.resolve([
          student({ id: 's-1', firstName: 'Rahul', lastName: 'Verma', admissionNo: 'RPS-00001', userId: 'u1', guardianName: 'Anil Verma' }),
          student({ id: 's-2', firstName: 'Meera', lastName: 'Shah', admissionNo: 'RPS-00002', userId: null, guardianName: 'Priya Shah' }),
        ]);
      }
      return Promise.resolve([]);
    });
  }

  it('states the login status as a pill, not as a second row of buttons', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get3() }) as never);
    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText('Has login')).toBeInTheDocument();
    expect(screen.getByText('No login')).toBeInTheDocument();
  });

  it('carries the action at icon size, with its words on the label', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get3() }) as never);
    renderWithProviders(<StudentsPage />);

    // Reachable and named for a screen reader…
    expect(await screen.findByRole('button', { name: /Resend the portal invite to Rahul Verma/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create a portal login for Meera Shah/ })).toBeInTheDocument();
    // …but its label is not a text node taking a line of its own.
    expect(screen.queryByText('Resend invite')).not.toBeInTheDocument();
    expect(screen.queryByText('Create login')).not.toBeInTheDocument();
  });
});

/**
 * Eight hundred children is not a list you scroll. Search is over the rows
 * already loaded — the list arrives whole under a ceiling — so it is instant
 * and cannot disagree with the counts above it.
 */
describe('finding one child among eight hundred', () => {
  function get2() {
    return vi.fn((path: string) => {
      if (path.startsWith('/manage/classes')) return Promise.resolve([]);
      if (path.startsWith('/manage/students')) {
        return Promise.resolve([
          student({ id: 's-1', firstName: 'Rahul', lastName: 'Verma', admissionNo: 'RPS-00001', guardianName: 'Anil Verma' }),
          student({ id: 's-2', firstName: 'Meera', lastName: 'Shah', admissionNo: 'RPS-00002', guardianName: 'Priya Shah' }),
        ]);
      }
      return Promise.resolve([]);
    });
  }

  it('matches a name', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get2() }) as never);
    const user = userEvent.setup();
    renderWithProviders(<StudentsPage />);

    await screen.findByText('Rahul Verma');
    await user.type(screen.getByLabelText('Search students'), 'meera');

    expect(screen.getByText('Meera Shah')).toBeInTheDocument();
    expect(screen.queryByText('Rahul Verma')).not.toBeInTheDocument();
  });

  /** The office counter is usually holding an admission slip, not a name. */
  it('matches an admission number, and a guardian', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get2() }) as never);
    const user = userEvent.setup();
    renderWithProviders(<StudentsPage />);

    await screen.findByText('Rahul Verma');
    const box = screen.getByLabelText('Search students');
    await user.type(box, 'RPS-00002');
    expect(screen.getByText('Meera Shah')).toBeInTheDocument();
    expect(screen.queryByText('Rahul Verma')).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, 'Anil');
    expect(screen.getByText('Rahul Verma')).toBeInTheDocument();
    expect(screen.queryByText('Meera Shah')).not.toBeInTheDocument();
  });

  /**
   * A search that matches nothing is not an empty school, and "add one above"
   * would be the wrong advice — wrong advice reads as a broken page.
   */
  it('says nobody matched, rather than telling you to add a student', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    vi.mocked(useApi).mockReturnValue(mockApi({ get: get2() }) as never);
    const user = userEvent.setup();
    renderWithProviders(<StudentsPage />);

    await screen.findByText('Rahul Verma');
    await user.type(screen.getByLabelText('Search students'), 'zzzz');

    expect(screen.getByText(/Nobody matches/)).toBeInTheDocument();
    expect(screen.queryByText(/Add the first one/)).not.toBeInTheDocument();
  });
});

describe('the table primitive keeps a row on one line', () => {
  it('sets nowrap on every cell, and a sticky header that survives scrolling', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');
    const body = (sel: string) => {
      const at = css.indexOf(sel);
      expect(at, `${sel} is missing`).toBeGreaterThan(-1);
      const open = css.indexOf('{', at);
      return css.slice(open, css.indexOf('}', open));
    };

    expect(body('.sk-tbl td {')).toMatch(/white-space:\s*nowrap/);
    expect(body('.sk-tbl th {')).toMatch(/position:\s*sticky/);
    // A border-bottom on a sticky cell scrolls away with it in some engines.
    expect(body('.sk-tbl th {')).toMatch(/box-shadow:\s*inset/);
  });
});

/**
 * ACTIVE ROSTER. The roll has three slices — the school as it is today, the
 * children who have left, and the whole register — and a child who has left
 * keeps their row, their history and a chip that says where they went.
 */
describe('the roll has an Active tab, an Alumni & left tab, and All', () => {
  function getRoll(rows: StudentRow[]) {
    return vi.fn((path: string) => {
      if (path.startsWith('/manage/classes')) return Promise.resolve([]);
      if (path.startsWith('/manage/students')) return Promise.resolve(rows);
      if (path.startsWith('/auth/me')) return Promise.resolve({ features: ['MANAGEMENT'] });
      return Promise.resolve([]);
    });
  }

  it('asks the API for the active slice by default, and for the left slice on that tab', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const get = getRoll([student({ id: 's-1', firstName: 'Rahul', lastName: 'Verma' })]);
    vi.mocked(useApi).mockReturnValue(mockApi({ get }) as never);
    const user = userEvent.setup();
    renderWithProviders(<StudentsPage />);

    await screen.findByText('Rahul Verma');
    expect(get).toHaveBeenCalledWith('/manage/students?status=active');

    await user.click(screen.getByRole('button', { name: 'Alumni & left' }));
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('/manage/students?status=left'));
  });

  it('a child who left keeps a row with a status chip and a Re-admit action, never Delete', async () => {
    const get = getRoll([
      student({ id: 's-2', firstName: 'Meera', lastName: 'Shah', status: 'ALUMNI', alumniBatch: '2025-26', leftOn: '2026-03-31' }),
    ]);
    vi.mocked(useApi).mockReturnValue(mockApi({ get }) as never);
    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText('Alumni · 2025-26')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-admit Meera Shah' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Meera Shah/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark Meera Shah as left/ })).not.toBeInTheDocument();
  });

  it('Mark as left opens the dialog for that child, with the clearance warning', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const get = vi.fn((path: string) => {
      if (path.startsWith('/manage/classes')) return Promise.resolve([]);
      if (path.startsWith('/manage/students/s-1/clearance')) {
        return Promise.resolve({ libraryIssuesOut: 2, finesDueRupees: 0, feeDuesRupees: 1500, unsignedRemarks: 0, hasHistory: true });
      }
      if (path.startsWith('/manage/students')) return Promise.resolve([student({ id: 's-1', firstName: 'Rahul', lastName: 'Verma' })]);
      if (path.startsWith('/auth/me')) return Promise.resolve({ features: ['MANAGEMENT'] });
      return Promise.resolve([]);
    });
    vi.mocked(useApi).mockReturnValue(mockApi({ get }) as never);
    const user = userEvent.setup();
    renderWithProviders(<StudentsPage />);

    await screen.findByText('Rahul Verma');
    await user.click(screen.getByRole('button', { name: 'Mark Rahul Verma as left' }));

    expect(await screen.findByRole('dialog', { name: 'Mark Rahul Verma as left' })).toBeInTheDocument();
    expect(await screen.findByText('2 library books still out')).toBeInTheDocument();
    expect(screen.getByText('₹1,500 in fees outstanding')).toBeInTheDocument();
  });

  it('selecting children on the Active tab offers one Mark as left for all of them', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const get = getRoll([
      student({ id: 's-1', firstName: 'Rahul', lastName: 'Verma' }),
      student({ id: 's-2', firstName: 'Meera', lastName: 'Shah' }),
    ]);
    vi.mocked(useApi).mockReturnValue(mockApi({ get }) as never);
    const user = userEvent.setup();
    renderWithProviders(<StudentsPage />);

    await screen.findByText('Rahul Verma');
    await user.click(screen.getByLabelText('Select every student shown'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Mark as left/ }));
    expect(await screen.findByRole('dialog', { name: 'Mark 2 students as left' })).toBeInTheDocument();
  });
});

describe('Sessions on the Students page', () => {
  it('offers a Session select in the Add form while a next session is open, filters classes by it, and groups the class filter by session', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const api = mockApi({
      get: vi.fn((url: string) => {
        if (url.startsWith('/manage/sessions')) {
          return Promise.resolve({
            years: [{ id: 'y1', name: '2025-26', isCurrent: true }, { id: 'y2', name: '2026-27', isCurrent: false }],
            plan: { id: 'p1', status: 'DRAFT', toYearId: 'y2' },
          });
        }
        if (url.startsWith('/manage/classes')) {
          return Promise.resolve([
            { id: 'f5b', name: 'B', grade: { name: '5' }, academicYear: { id: 'y1', name: '2025-26', isCurrent: true } },
            { id: 't6b', name: 'B', grade: { name: '6' }, academicYear: { id: 'y2', name: '2026-27', isCurrent: false } },
          ]);
        }
        if (url.startsWith('/auth/me')) return Promise.resolve({ features: ['MANAGEMENT'] });
        return Promise.resolve([]);
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<StudentsPage />);
    await user.click(await screen.findByRole('button', { name: /Add student/ }));
    expect(await screen.findByText(/Admitting for 2026-27\?/)).toBeInTheDocument();
    // Current session: only this year's classes in the form's class select.
    const { within } = await import('@testing-library/react');
    const classSelect = () => within(screen.getByLabelText('Class (optional)'));
    expect(classSelect().getByRole('option', { name: '5 — B' })).toBeInTheDocument();
    expect(classSelect().queryByRole('option', { name: '6 — B' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Session'), 'y2');
    expect(classSelect().getByRole('option', { name: '6 — B' })).toBeInTheDocument();
    expect(screen.queryByText(/Admitting for 2026-27\?/)).toBeNull();
    // The class filter groups by session name.
    expect(screen.getByRole('group', { name: '2025-26' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '2026-27' })).toBeInTheDocument();
    // The default list is the running year's register.
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('academicYearId=y1'));
  });
});
