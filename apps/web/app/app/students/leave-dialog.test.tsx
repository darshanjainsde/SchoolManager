import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import LeaveDialog from './leave-dialog';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rahul = { id: 's-1', firstName: 'Rahul', lastName: 'Verma', admissionNo: 'RPS-00001' };
const meera = { id: 's-2', firstName: 'Meera', lastName: 'Shah', admissionNo: 'RPS-00002' };

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('LeaveDialog — Mark as left', () => {
  it('shows the clearance warnings and posts the leave with the chosen reason and date', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const get = vi.fn().mockResolvedValue({ libraryIssuesOut: 1, finesDueRupees: 50, feeDuesRupees: 0, unsignedRemarks: 2, hasHistory: true });
    const post = vi.fn().mockResolvedValue({ id: 's-1', status: 'TRANSFERRED' });
    vi.mocked(useApi).mockReturnValue(mockApi({ get, post }) as never);
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<LeaveDialog students={[rahul]} onDone={onDone} onCancel={vi.fn()} />);

    expect(await screen.findByText('1 library book still out')).toBeInTheDocument();
    expect(screen.getByText('₹50 in library fines due')).toBeInTheDocument();
    expect(screen.getByText('2 diary remarks not signed')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/manage/students/s-1/clearance');

    await user.click(screen.getByLabelText('Moved to another school'));
    await user.type(screen.getByLabelText('Reason'), 'Moved city');
    await user.click(screen.getByRole('button', { name: 'Mark as left' }));

    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/manage/students/s-1/leave',
        expect.objectContaining({ status: 'TRANSFERRED', reason: 'Moved city', leftOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      ),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('a selection posts one leave per child, in order, and skips the clearance read', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const get = vi.fn();
    const post = vi.fn().mockResolvedValue({});
    vi.mocked(useApi).mockReturnValue(mockApi({ get, post }) as never);
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<LeaveDialog students={[rahul, meera]} onDone={onDone} onCancel={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Mark 2 students as left' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('Passed out'));
    await user.click(screen.getByRole('button', { name: 'Mark as left' }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/manage/students/s-1/leave', '/manage/students/s-2/leave']);
    expect(post.mock.calls[0][1]).toMatchObject({ status: 'ALUMNI' });
    expect(get).not.toHaveBeenCalled();
  });

  it('Escape and Cancel both close it without posting', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const post = vi.fn();
    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn().mockResolvedValue(null), post }) as never);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<LeaveDialog students={[rahul]} onDone={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
  });
});
