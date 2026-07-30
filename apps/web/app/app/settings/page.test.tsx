import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import SettingsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

/**
 * The settings page fires four GET queries on mount (years, periods,
 * working-days, class-note-visibility). Route by path so a test only has to
 * override the one query it cares about — every other card just renders its
 * own (unasserted) empty state.
 */
function routedGet(overrides: Partial<Record<string, unknown>> = {}) {
  return vi.fn((path: string) => {
    if (path === '/manage/years') return Promise.resolve(overrides.years ?? []);
    if (path === '/manage/periods') return Promise.resolve(overrides.periods ?? []);
    if (path === '/manage/school/working-days') {
      return Promise.resolve(overrides.workingDays ?? { workingDays: [] });
    }
    if (path === '/manage/school/class-note-visibility') {
      return Promise.resolve(overrides.classNoteVisibility ?? { classNoteVisibility: 'ALL_TEACHERS' });
    }
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
}

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: routedGet(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function renderPage() {
  return renderWithProviders(
    <>
      <SettingsPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

async function findVisibilityCard(): Promise<HTMLElement> {
  const heading = await screen.findByText('Class notes visibility');
  const card = heading.closest('.sk-card');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('SettingsPage — class notes visibility', () => {
  it('reflects the current value from the server', async () => {
    const api = mockApi({
      get: routedGet({ classNoteVisibility: { classNoteVisibility: 'SUBJECT_TEACHERS' } }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const card = await findVisibilityCard();

    const subjectRadio = await within(card).findByRole('radio', { name: /Only the subject/ });
    const allRadio = within(card).getByRole('radio', { name: /Any teacher of the class/ });
    expect(subjectRadio).toBeChecked();
    expect(allRadio).not.toBeChecked();
  });

  it('defaults to "Any teacher of the class" when the server reports ALL_TEACHERS', async () => {
    const api = mockApi({
      get: routedGet({ classNoteVisibility: { classNoteVisibility: 'ALL_TEACHERS' } }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const card = await findVisibilityCard();

    const allRadio = await within(card).findByRole('radio', { name: /Any teacher of the class/ });
    expect(allRadio).toBeChecked();
  });

  it('selecting a different option saves it and confirms', async () => {
    const user = userEvent.setup();
    const put = vi.fn().mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
    const api = mockApi({ put });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const card = await findVisibilityCard();

    const subjectRadio = await within(card).findByRole('radio', { name: /Only the subject/ });
    await user.click(subjectRadio);

    expect(put).toHaveBeenCalledWith('/manage/school/class-note-visibility', {
      classNoteVisibility: 'SUBJECT_TEACHERS',
    });
    expect(await screen.findByText('Class notes visibility updated')).toBeInTheDocument();
  });

  it('shows the server error message when the setting fails to load', async () => {
    const api = mockApi({
      get: vi.fn((path: string) => {
        if (path === '/manage/school/class-note-visibility') {
          return Promise.reject(new Error('Visibility service is unavailable'));
        }
        return routedGet()(path);
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const card = await findVisibilityCard();

    expect(await within(card).findByText('Visibility service is unavailable')).toBeInTheDocument();
    expect(within(card).queryByRole('radio')).not.toBeInTheDocument();
  });
});
