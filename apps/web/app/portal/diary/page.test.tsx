import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
  it('shows the page and says how many remarks still need signing', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({ entries: [ITEM, REMARK], unsignedCount: 1 }) as never,
    );
    renderPage();

    expect(await screen.findByText('Maths worksheet 7.3.')).toBeInTheDocument();
    expect(screen.getByText(/1 still to sign/)).toBeInTheDocument();
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
