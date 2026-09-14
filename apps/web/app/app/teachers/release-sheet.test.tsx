import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import ReleaseSheet from './release-sheet';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const priya = { id: 'T1', firstName: 'Priya', lastName: 'Iyer' };

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function get(impact: object) {
  return vi.fn((path: string) => {
    if (path.endsWith('/release-impact')) return Promise.resolve(impact);
    if (path === '/manage/teachers') {
      return Promise.resolve([
        { id: 'T1', firstName: 'Priya', lastName: 'Iyer', isActive: true },
        { id: 'T2', firstName: 'Rohan', lastName: 'Das', isActive: true },
        { id: 'T3', firstName: 'Gone', lastName: 'Already', isActive: false },
      ]);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('ReleaseSheet — Remove from this school', () => {
  it('lists what the teacher holds, offers only active colleagues, and posts the handover map', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const post = vi.fn().mockResolvedValue({ released: true });
    vi.mocked(useApi).mockReturnValue(
      mockApi({
        get: get({ classTeacherOf: [{ id: 'sec-5a', label: '5 A' }], timetableSlots: 12, pendingLeave: 1, featuredOnWebsite: true, libraryIssuesOut: 0, openThreads: 3 }),
        post,
      }) as never,
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ReleaseSheet teacher={priya} onDone={onDone} onCancel={vi.fn()} />);

    expect(await screen.findByText('Class teacher of 5 A')).toBeInTheDocument();
    expect(screen.getByText('12 timetable periods')).toBeInTheDocument();
    expect(screen.getByText('1 pending leave application will be declined')).toBeInTheDocument();
    expect(screen.getByText('3 message threads become read-only for families')).toBeInTheDocument();

    const seat = screen.getByLabelText('New class teacher for 5 A');
    expect(Array.from((seat as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      'Leave the seat empty for now',
      'Rohan Das',
    ]);
    await user.selectOptions(seat, 'T2');
    await user.selectOptions(screen.getByLabelText('Hand periods to'), 'T2');
    await user.click(screen.getByLabelText('Keep them on the website'));
    await user.type(screen.getByLabelText('Reason'), 'Resigned');
    await user.click(screen.getByRole('button', { name: 'Remove from this school' }));

    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/manage/teachers/T1/release',
        expect.objectContaining({
          reason: 'Resigned',
          handover: { classSections: { 'sec-5a': 'T2' }, timetableTeacherId: 'T2', keepFeatured: true },
        }),
      ),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('a teacher who holds nothing can still be removed, with empty seats and unassigned periods', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const post = vi.fn().mockResolvedValue({ released: true });
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: get({ classTeacherOf: [], timetableSlots: 0, pendingLeave: 0, featuredOnWebsite: false, libraryIssuesOut: 0, openThreads: 0 }), post }) as never,
    );
    const user = userEvent.setup();
    renderWithProviders(<ReleaseSheet teacher={priya} onDone={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText(/nothing to hand over/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove from this school' }));
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/manage/teachers/T1/release',
        expect.objectContaining({ handover: { classSections: {}, timetableTeacherId: null, keepFeatured: false } }),
      ),
    );
  });
});
