import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { DiaryEntryRow, MyClassSection, RosterStudent } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherDiaryPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const CLASSES: MyClassSection[] = [
  { classSectionId: 'cs1', name: '8-C', studentCount: 28, covering: false },
];
const ROSTER: RosterStudent[] = [
  { id: 'stu-aarav', firstName: 'Aarav', lastName: 'Sharma', rollNo: '1' },
  { id: 'stu-diya', firstName: 'Diya', lastName: 'Rao', rollNo: '2' },
];

function iso(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function entry(over: Partial<DiaryEntryRow> = {}): DiaryEntryRow {
  return {
    id: 'e1',
    date: iso(),
    kind: 'ITEM',
    audience: 'ALL',
    body: 'Maths worksheet 7.3.',
    subjectId: null,
    subjectName: null,
    authorTeacherId: 't1',
    authorName: 'Meera Iyer',
    students: [],
    seenCount: 12,
    signedCount: 0,
    recipientCount: 28,
    createdAt: '2026-08-03T09:00:00.000Z',
    editable: true,
    ...over,
  };
}

function mockGet(entries: DiaryEntryRow[] = []) {
  return vi.fn().mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance/my-classes')) return Promise.resolve(CLASSES);
    if (path.startsWith('/manage/students')) return Promise.resolve(ROSTER);
    if (path.startsWith('/manage/diary'))
      return Promise.resolve({
        date: iso(),
        classSectionId: 'cs1',
        className: '8-C',
        entries,
      });
    throw new Error(`unexpected path: ${path}`);
  });
}

function stub(over: Partial<ApiStub> = {}): ApiStub {
  return { get: mockGet(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over };
}

function renderPage() {
  return renderWithProviders(
    <>
      <TeacherDiaryPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherDiaryPage', () => {
  it('shows the day’s entries with their read receipts', async () => {
    vi.mocked(useApi).mockReturnValue(stub({ get: mockGet([entry()]) }) as never);
    renderPage();

    expect(await screen.findByText('Maths worksheet 7.3.')).toBeInTheDocument();
    expect(screen.getByText(/12\/28 opened/)).toBeInTheDocument();
  });

  it('an entry with nobody named goes to the whole class', async () => {
    const post = vi.fn().mockResolvedValue(entry({ id: 'new' }));
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByTestId('diary-body'), 'Bring your art file.');
    await user.click(screen.getByTestId('diary-send'));

    expect(post).toHaveBeenCalledWith(
      '/manage/diary',
      expect.objectContaining({ kind: 'ITEM', audience: 'ALL', body: 'Bring your art file.' }),
    );
    expect(post.mock.calls[0][1]).not.toHaveProperty('studentIds');
  });

  it('typing a name and picking the match sends only to that child', async () => {
    const post = vi.fn().mockResolvedValue(entry({ id: 'new', audience: 'SELECTED' }));
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByTestId('picker-input'), 'aar');
    await user.click(await screen.findByTestId('match-stu-aarav'));
    expect(screen.getByTestId('token-stu-aarav')).toBeInTheDocument();

    await user.type(screen.getByTestId('diary-body'), 'Please bring the signed form.');
    await user.click(screen.getByTestId('diary-send'));

    expect(post).toHaveBeenCalledWith(
      '/manage/diary',
      expect.objectContaining({ audience: 'SELECTED', studentIds: ['stu-aarav'] }),
    );
  });

  it('a remark states that the parents are emailed and cannot be sent unnamed', async () => {
    const post = vi.fn().mockResolvedValue(entry({ id: 'new', kind: 'REMARK' }));
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('diary-kind-REMARK'));
    await user.type(screen.getByTestId('diary-body'), 'Disrupted the lesson twice.');

    expect(screen.getByText(/always emailed to the parents/i)).toBeInTheDocument();
    expect(screen.getByTestId('diary-send')).toBeDisabled();

    await user.type(screen.getByTestId('picker-input'), 'diya');
    await user.click(await screen.findByTestId('match-stu-diya'));
    await user.click(screen.getByTestId('diary-send'));

    expect(post).toHaveBeenCalledWith(
      '/manage/diary',
      expect.objectContaining({ kind: 'REMARK', studentIds: ['stu-diya'] }),
    );
  });

  it('a past page swaps the composer for the reason it is closed', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('diary-prev'));

    expect(await screen.findByTestId('diary-closed')).toBeInTheDocument();
    expect(screen.queryByTestId('diary-compose')).not.toBeInTheDocument();
  });
});
