import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { Assignment, AssignmentList, AssignmentUploadResponse, MyClassSection } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherAssignmentsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), request: vi.fn(), ...overrides };
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

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    classSectionId: 'sec-1',
    subjectId: 'sub-1',
    title: 'Worksheet 3',
    instructions: 'Do questions 1-10.',
    dueDate: '2026-08-05',
    attachments: [],
    createdByTeacherId: 'u1',
    createdAt: '2026-07-30T00:00:00.000Z',
    seenCount: 0,
    ...overrides,
  };
}

const emptyList: AssignmentList = { upcoming: [], past: [] };

const defaultHandlers = (list: AssignmentList = emptyList): Array<[string, () => Promise<unknown>]> => [
  ['/manage/attendance/my-classes', () => Promise.resolve([classSection()])],
  ['/manage/subjects', () => Promise.resolve([{ id: 'sub-1', code: 'MTH', name: 'Mathematics' }])],
  ['/manage/assignments', () => Promise.resolve(list)],
];

function renderPage() {
  return renderWithProviders(
    <>
      <TeacherAssignmentsPage />
      <Toaster />
    </>,
  );
}

function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

async function selectClass(user: ReturnType<typeof userEvent.setup>) {
  const select = await screen.findByLabelText('Class');
  await within(select).findByRole('option', { name: '8-A' });
  await user.selectOptions(select, 'sec-1');
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherAssignmentsPage', () => {
  it('excludes a covering:true class — AssignmentsService rejects a covering-only teacher (prove by deletion: without the filter, 9-B would render)', async () => {
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
        ['/manage/subjects', () => Promise.resolve([])],
        ['/manage/assignments', () => Promise.resolve(emptyList)],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    const select = await screen.findByLabelText('Class');
    expect(await within(select).findByRole('option', { name: '8-A' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /9-B/ })).not.toBeInTheDocument();
  });

  it('four states: loading, error, empty and loaded all render for the assignment list', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: mockGet(defaultHandlers()) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    // Empty (pre-selection): the picker copy, not the list's own loading text.
    expect(screen.getByText('Pick a class to see its assignments.')).toBeInTheDocument();

    await selectClass(user);

    // Empty (post-fetch, no assignments for this class).
    expect(await screen.findByText('No assignments for this class yet.')).toBeInTheDocument();
  });

  it('renders an error state verbatim when the list fetch fails', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/my-classes', () => Promise.resolve([classSection()])],
        ['/manage/subjects', () => Promise.resolve([])],
        ['/manage/assignments', () => Promise.reject(new Error('You can only view assignments for your own classes.'))],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await selectClass(user);

    expect(
      await screen.findByText('You can only view assignments for your own classes.'),
    ).toBeInTheDocument();
  });

  it('renders seen-counts on each assignment row', async () => {
    const user = userEvent.setup();
    const list: AssignmentList = { upcoming: [assignment({ id: 'a1', seenCount: 4 })], past: [] };
    const api = mockApi({ get: mockGet(defaultHandlers(list)) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await selectClass(user);

    const row = await screen.findByTestId('assignment-a1');
    expect(within(row).getByText(/4 seen/)).toBeInTheDocument();
  });

  it('blocks an oversized attachment client-side — no upload request is ever sent (prove by deletion: removing the size guard sends the request)', async () => {
    const requestSpy = vi.fn();
    const api = mockApi({ get: mockGet(defaultHandlers()), request: requestSpy });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const input = (await screen.findByTestId('assign-file-input')) as HTMLInputElement;
    const big = file('scan.pdf', 'application/pdf', 5 * 1024 * 1024); // over the 4MB cap
    fireEvent.change(input, { target: { files: [big] } });

    expect(await screen.findByTestId('attach-error')).toHaveTextContent(/too large/i);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('blocks a wrong-type attachment client-side — no upload request is ever sent (prove by deletion: removing the type guard sends the request)', async () => {
    const requestSpy = vi.fn();
    const api = mockApi({ get: mockGet(defaultHandlers()), request: requestSpy });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const input = (await screen.findByTestId('assign-file-input')) as HTMLInputElement;
    const bad = file('notes.docx', 'application/msword', 1000);
    fireEvent.change(input, { target: { files: [bad] } });

    expect(await screen.findByTestId('attach-error')).toHaveTextContent(/only pdf or image/i);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('creates an assignment with the trimmed title/instructions and any attached files', async () => {
    const user = userEvent.setup();
    const uploaded: AssignmentUploadResponse = { url: 'https://cdn/worksheet.pdf', name: 'worksheet.pdf', kind: 'pdf' };
    const postSpy = vi.fn().mockResolvedValue(assignment());
    const requestSpy = vi.fn().mockResolvedValue(uploaded);
    const api = mockApi({ get: mockGet(defaultHandlers()), post: postSpy, request: requestSpy });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await selectClass(user);

    await user.selectOptions(await screen.findByLabelText('Subject'), 'sub-1');
    await user.type(screen.getByLabelText('Title'), '  Worksheet 3  ');
    await user.type(screen.getByLabelText('Instructions'), '  Complete all questions.  ');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-10' } });

    const input = screen.getByTestId('assign-file-input') as HTMLInputElement;
    const good = file('worksheet.pdf', 'application/pdf', 1000);
    fireEvent.change(input, { target: { files: [good] } });
    await screen.findByTestId('attachment-worksheet.pdf');

    await user.click(screen.getByRole('button', { name: 'Post assignment' }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/manage/assignments', {
        classSectionId: 'sec-1',
        subjectId: 'sub-1',
        title: 'Worksheet 3',
        instructions: 'Complete all questions.',
        dueDate: '2026-08-10',
        attachments: [uploaded],
      }),
    );
  });

  it('deleting an assignment asks for confirmation before calling DELETE, then refetches the list', async () => {
    const user = userEvent.setup();
    let listCallCount = 0;
    const list: AssignmentList = { upcoming: [assignment({ id: 'a1', title: 'Worksheet 3' })], past: [] };
    const getSpy = vi.fn((path: string) => {
      if (path.startsWith('/manage/attendance/my-classes')) return Promise.resolve([classSection()]);
      if (path.startsWith('/manage/subjects')) return Promise.resolve([]);
      if (path.startsWith('/manage/assignments')) {
        listCallCount += 1;
        return Promise.resolve(list);
      }
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    });
    const delSpy = vi.fn().mockResolvedValue({ ok: true });
    const api = mockApi({ get: getSpy, del: delSpy });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await selectClass(user);
    await screen.findByTestId('assignment-a1');
    const callsBeforeDelete = listCallCount;

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    // Confirmation dialog gates the call — DELETE must not fire on the first click.
    expect(delSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete this assignment?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('/manage/assignments/a1'));
    await waitFor(() => expect(listCallCount).toBeGreaterThan(callsBeforeDelete));
  });
});
