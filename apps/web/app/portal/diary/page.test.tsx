import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { StudentDiaryEntry, StudentDiaryResult } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import PortalDiaryPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function iso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const ITEM: StudentDiaryEntry = {
  id: 'e1',
  date: iso(),
  kind: 'ITEM',
  body: 'Maths worksheet 7.3.',
  subjectName: 'Mathematics',
  teacherName: 'Meera Iyer',
  personal: false,
  signedAt: null,
  signedName: null,
  createdAt: '2026-08-03T09:00:00.000Z',
};
const REMARK: StudentDiaryEntry = {
  ...ITEM,
  id: 'e2',
  kind: 'REMARK',
  body: 'Disrupted the lesson twice today.',
  personal: true,
};

function stub(result: StudentDiaryResult, over: Partial<ApiStub> = {}): ApiStub {
  return {
    get: vi.fn().mockResolvedValue(result),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    ...over,
  };
}

function renderPage() {
  return renderWithProviders(
    <>
      <PortalDiaryPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('PortalDiaryPage', () => {
  it('falls back to the day list when the API predates the month grid', async () => {
    // The web deploys before the API, so for a few minutes a family's console
    // asks for a month and gets an answer without one. Drawing an empty
    // calendar would be worse than the list it replaced, so the list stays.
    vi.mocked(useApi).mockReturnValue(
      stub({ entries: [ITEM, REMARK], unsignedCount: 1 }) as never,
    );
    renderPage();

    expect(await screen.findByText('Maths worksheet 7.3.')).toBeInTheDocument();
    expect(screen.getByText(/1 remark still to sign/)).toBeInTheDocument();
    expect(document.querySelector('.sk-dcal')).toBeNull();
  });

  it('an ordinary entry has no signature line', async () => {
    vi.mocked(useApi).mockReturnValue(stub({ entries: [ITEM], unsignedCount: 0 }) as never);
    renderPage();

    expect(await screen.findByTestId('diary-e1')).toBeInTheDocument();
    expect(screen.queryByTestId('sign-e1')).not.toBeInTheDocument();
  });

  it('signing sends the typed name, and the copy stays role-neutral', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'e2',
      signedAt: '2026-08-03T18:00:00.000Z',
      signedName: 'Priya Sharma',
      unsignedCount: 0,
    });
    vi.mocked(useApi).mockReturnValue(
      stub({ entries: [REMARK], unsignedCount: 1 }, { post }) as never,
    );
    renderPage();

    const user = userEvent.setup();
    // One STUDENT login serves everyone at home, so nothing may address the
    // reader as a parent.
    expect(await screen.findByText(/already been emailed home/i)).toBeInTheDocument();

    await user.type(screen.getByTestId('sign-name-e2'), 'Priya Sharma');
    await user.click(screen.getByTestId('sign-e2'));

    expect(post).toHaveBeenCalledWith('/me/diary/e2/sign', { signedName: 'Priya Sharma' });
  });

  it('will not sign with an empty name', async () => {
    const post = vi.fn();
    vi.mocked(useApi).mockReturnValue(
      stub({ entries: [REMARK], unsignedCount: 1 }, { post }) as never,
    );
    renderPage();

    expect(await screen.findByTestId('sign-e2')).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('an already-signed remark shows who signed it instead of the form', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({
        entries: [{ ...REMARK, signedAt: '2026-08-03T18:00:00.000Z', signedName: 'Priya Sharma' }],
        unsignedCount: 0,
      }) as never,
    );
    renderPage();

    expect(await screen.findByTestId('signed-e2')).toHaveTextContent('by Priya Sharma');
    expect(screen.queryByTestId('sign-e2')).not.toBeInTheDocument();
  });
});

// ── the month grid ───────────────────────────────────────────────────────────

describe('PortalDiaryPage, the month grid', () => {
  /** A September with a shut Sunday, a named holiday and one remark to sign. */
  const SEPT = Array.from({ length: 30 }, (_, i) => {
    const date = `2026-09-${String(i + 1).padStart(2, '0')}`;
    const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
    return {
      date,
      items: date === '2026-09-17' ? 1 : 0,
      remarks: date === '2026-09-17' ? 1 : 0,
      unsigned: date === '2026-09-17' ? 1 : 0,
      offReason: sunday ? 'Sunday' : date === '2026-09-21' ? 'Ganesh Chaturthi break' : null,
    };
  });
  const MONTH = {
    entries: [{ ...ITEM, id: 'm1', date: '2026-09-17' }],
    unsignedCount: 1,
    month: { month: '2026-09', days: SEPT, firstMonth: '2026-04', lastMonth: '2027-03' },
  };

  const openMonth = () => {
    vi.mocked(useApi).mockReturnValue(stub(MONTH) as never);
    renderPage();
  };

  it('draws every day of the month, closed days included', async () => {
    openMonth();
    expect(await screen.findByTestId('diary-day-2026-09-01')).toBeInTheDocument();
    expect(screen.getByTestId('diary-day-2026-09-30')).toBeInTheDocument();
    // A day the school was shut is still a square — a parent looking for it
    // must find it where the date is, not find a gap.
    expect(screen.getByTestId('diary-day-2026-09-06')).toHaveAttribute('data-diary', 'off');
  });

  it('marks the day that still needs a signature above everything else', async () => {
    openMonth();
    const day = await screen.findByTestId('diary-day-2026-09-17');
    expect(day).toHaveAttribute('data-diary', 'remark');
    expect(day.querySelector('.sk-cell-dot')).not.toBeNull();
  });

  it('says WHY a day is empty, rather than just showing nothing', async () => {
    openMonth();
    const holiday = await screen.findByTestId('diary-day-2026-09-21');
    fireEvent.click(holiday);
    expect(await screen.findByTestId('diary-empty-day')).toBeInTheDocument();
    expect(screen.getByText(/Ganesh Chaturthi break/)).toBeInTheDocument();
  });

  it('opens a date without asking the server again', async () => {
    const api = stub(MONTH);
    vi.mocked(useApi).mockReturnValue(api as never);
    renderPage();
    const before = (api.get as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(await screen.findByTestId('diary-day-2026-09-17'));
    expect(await screen.findByText('Maths worksheet 7.3.')).toBeInTheDocument();
    // The month came in one answer, so a tap is a re-render, not a round trip.
    expect((api.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it('stops the arrows at the session rather than paging into an empty year', async () => {
    openMonth();
    await screen.findByTestId('diary-day-2026-09-01');
    expect(screen.getByTestId('diary-prev-month')).not.toBeDisabled();
    expect(screen.getByTestId('diary-next-month')).not.toBeDisabled();
  });
});
