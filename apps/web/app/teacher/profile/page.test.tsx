import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TeacherProfile } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherProfilePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function profile(overrides: Partial<TeacherProfile> = {}): TeacherProfile {
  return {
    id: 't-1',
    firstName: 'Priya',
    lastName: 'Rao',
    email: 'priya@example.com',
    phone: '9999999999',
    subjects: ['Chemistry', 'Physics'],
    classTeacherOf: ['9-A'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherProfilePage', () => {
  it('renders a loading state while the profile is fetching', () => {
    let resolve!: (v: TeacherProfile) => void;
    const pending = new Promise<TeacherProfile>((r) => {
      resolve = r;
    });
    const api = mockApi({ get: vi.fn().mockReturnValue(pending) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherProfilePage />);

    expect(screen.getByText('Loading profile…')).toBeInTheDocument();
    resolve(profile());
  });

  it('renders the server error message when the profile fails to load', async () => {
    const api = mockApi({ get: vi.fn().mockRejectedValue(new Error('No teacher profile found for this login')) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherProfilePage />);

    expect(await screen.findByText('No teacher profile found for this login')).toBeInTheDocument();
    expect(screen.queryByText('Loading profile…')).not.toBeInTheDocument();
  });

  it('renders name, email, subjects and class-teacher-of from the endpoint', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue(profile()) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherProfilePage />);

    expect(await screen.findByText('Priya Rao')).toBeInTheDocument();
    expect(screen.getByText('priya@example.com')).toBeInTheDocument();
    expect(screen.getByText('Chemistry')).toBeInTheDocument();
    expect(screen.getByText('Physics')).toBeInTheDocument();
    expect(screen.getByText('9-A')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/manage/teachers/me');
  });

  it('a teacher with no subjects and no class-teacher role renders explicit "none" states, not blank rows', async () => {
    const api = mockApi({
      get: vi.fn().mockResolvedValue(profile({ subjects: [], classTeacherOf: [], email: null, phone: null })),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherProfilePage />);

    expect(await screen.findByText('No subjects assigned')).toBeInTheDocument();
    expect(screen.getByText('Not a class teacher')).toBeInTheDocument();
    expect(screen.getAllByText('Not on file')).toHaveLength(2);
  });

  it('changing password posts { currentPassword, newPassword } and clears the fields on success', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue(profile()),
      post: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherProfilePage />);
    await screen.findByText('Priya Rao');

    await user.type(screen.getByLabelText('Current password'), 'oldpass1');
    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(api.post).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'oldpass1',
      newPassword: 'newpass123',
    });
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('a new password under 8 characters is blocked client-side and fires no request', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: vi.fn().mockResolvedValue(profile()), post: vi.fn() });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherProfilePage />);
    await screen.findByText('Priya Rao');

    await user.type(screen.getByLabelText('Current password'), 'oldpass1');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('minLength', '8');
  });

  it('a failed password change surfaces the server message and does NOT clear the fields', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue(profile()),
      post: vi.fn().mockRejectedValue(new Error('Current password is incorrect')),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherProfilePage />);
    await screen.findByText('Priya Rao');

    await user.type(screen.getByLabelText('Current password'), 'wrongpass');
    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    // Losing what was typed at the moment the current password was wrong is
    // the worst possible time to clear it.
    expect(screen.getByLabelText('Current password')).toHaveValue('wrongpass');
    expect(screen.getByLabelText('New password')).toHaveValue('newpass123');
  });
});
