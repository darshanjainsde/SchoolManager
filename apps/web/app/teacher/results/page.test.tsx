import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { ExamList, MyClassSection } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherResultsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

/** Routes GET calls by path prefix so one test can stub every endpoint the page calls. */
function mockGet(handlers: Array<[string, () => Promise<unknown>]>) {
  return vi.fn((path: string) => {
    const hit = handlers.find(([prefix]) => path.startsWith(prefix));
    if (!hit) return Promise.reject(new Error(`Unhandled GET ${path}`));
    return hit[1]();
  });
}

function classSection(overrides: Partial<MyClassSection> = {}): MyClassSection {
  return { classSectionId: 'sec-1', name: '8-A', studentCount: 30, covering: false, ...overrides };
}

const emptyExams: ExamList = { upcoming: [], past: [] };

function renderPage() {
  return renderWithProviders(
    <>
      <TeacherResultsPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherResultsPage', () => {
  it('populates the class picker from /manage/attendance/my-classes, using its already-composed names', async () => {
    // `/manage/attendance/my-classes` returns `{ classSectionId, name, ... }`
    // with `name` already composed ("8-A"), unlike `/manage/classes`'
    // `{id, name, grade:{name}}` shape — the option list must render it as-is.
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/my-classes', () => Promise.resolve([classSection()])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    const select = await screen.findByLabelText('Class');
    expect(within(select).getByRole('option', { name: '8-A' })).toBeInTheDocument();

    const getPaths = vi.mocked(api.get).mock.calls.map(([path]) => path);
    expect(getPaths.every((p) => !p.startsWith('/manage/classes'))).toBe(true);
  });

  it('excludes a covering:true class — the server rejects a covering-only teacher publishing results', async () => {
    const api = mockApi({
      get: mockGet([
        [
          '/manage/attendance/my-classes',
          () =>
            Promise.resolve([
              classSection({ classSectionId: 'sec-1', name: '8-A', covering: false }),
              classSection({ classSectionId: 'sec-2', name: '9-B', covering: true }),
            ]),
        ],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    const select = await screen.findByLabelText('Class');
    expect(within(select).getByRole('option', { name: '8-A' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /9-B/ })).not.toBeInTheDocument();
  });

  it('selecting a class fetches its exams by classSectionId', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/my-classes', () => Promise.resolve([classSection()])],
        ['/manage/exams', () => Promise.resolve(emptyExams)],
        ['/manage/students', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const select = await screen.findByLabelText('Class');
    await user.selectOptions(select, 'sec-1');

    expect(
      await screen.findByText('No tests scheduled for this class yet — schedule one from the Tests page.'),
    ).toBeInTheDocument();
    const getPaths = vi.mocked(api.get).mock.calls.map(([path]) => path);
    expect(getPaths.some((p) => p.startsWith('/manage/exams?classSectionId=sec-1'))).toBe(true);
  });
});
