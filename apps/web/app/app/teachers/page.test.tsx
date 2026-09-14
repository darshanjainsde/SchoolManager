import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeachersPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function getRoll(rows: object[]) {
  return vi.fn((path: string) => {
    if (path === '/manage/teachers') return Promise.resolve(rows);
    if (path.endsWith('/release-impact')) {
      return Promise.resolve({ classTeacherOf: [], timetableSlots: 0, pendingLeave: 0, featuredOnWebsite: false, libraryIssuesOut: 0, openThreads: 0 });
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

/**
 * ACTIVE ROSTER. A teacher leaves through "Remove from this school" (handover,
 * then the login closes), never through Delete; a row that has left says when,
 * and offers the way back.
 */
describe('teachers leave through the handover sheet, and can come back', () => {
  it('an active teacher has Remove from this school beside Delete; it opens the sheet', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: getRoll([{ id: 'T1', firstName: 'Priya', lastName: 'Iyer', isActive: true, status: 'ACTIVE', userId: 'u1' }]) }) as never,
    );
    const user = userEvent.setup();
    renderWithProviders(<TeachersPage />);

    await screen.findByText('Priya Iyer');
    expect(screen.getByRole('button', { name: 'Delete Priya Iyer' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Priya Iyer from this school' }));
    expect(await screen.findByRole('dialog', { name: 'Remove Priya Iyer from this school' })).toBeInTheDocument();
  });

  it('a teacher who left shows the date and a Reactivate action, not Delete', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const post = vi.fn().mockResolvedValue({ id: 'T2', status: 'ACTIVE' });
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: getRoll([{ id: 'T2', firstName: 'Rohan', lastName: 'Das', isActive: false, status: 'LEFT', leftOn: '2026-03-31', userId: null }]), post }) as never,
    );
    const user = userEvent.setup();
    renderWithProviders(<TeachersPage />);

    expect(await screen.findByText('Left · 31 Mar 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Rohan Das/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reactivate Rohan Das' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/manage/teachers/T2/reactivate', {}));
  });
});
