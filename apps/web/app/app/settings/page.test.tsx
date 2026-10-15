import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import SettingsPage from './page';
import { activeSettingsTab, SETTINGS_TABS } from './tabs';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const YEARS = [{ id: 'y1', name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', isCurrent: true }];
const PERIODS = [
  { id: 'p2', label: 'Period II', order: 2, startTime: '08:45', endTime: '09:30', kind: 'CLASS' },
  { id: 'p1', label: 'Period I', order: 1, startTime: '08:00', endTime: '08:45', kind: 'CLASS' },
  { id: 'b1', label: 'Break', order: 3, startTime: '09:30', endTime: '09:45', kind: 'BREAK' },
];

/** The School year tab fires three GETs; anything else is a mistake. */
function routedGet() {
  return vi.fn((path: string) => {
    if (path === '/manage/years') return Promise.resolve(YEARS);
    if (path === '/manage/periods') return Promise.resolve(PERIODS);
    if (path === '/manage/school/working-days') return Promise.resolve({ workingDays: [1, 2, 3, 4, 5, 6] });
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
}
function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  const api = { get: routedGet(), post: vi.fn().mockResolvedValue({ id: 'new' }), put: vi.fn().mockResolvedValue({}), patch: vi.fn(), del: vi.fn().mockResolvedValue({ ok: true }), ...overrides };
  vi.mocked(useApi).mockReturnValue(api as never);
  return api;
}
function renderPage() {
  return renderWithProviders(<><SettingsPage /><Toaster /></>);
}
beforeEach(() => vi.mocked(useHost).mockReturnValue('school.sckools.com'));

describe('Settings tabs', () => {
  it('three tabs, each its own route; deeper paths light their own tab, never School year', () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(['School year', 'Notifications', 'General']);
    expect(activeSettingsTab('/app/settings').label).toBe('School year');
    expect(activeSettingsTab('/app/settings/notifications').label).toBe('Notifications');
    expect(activeSettingsTab('/app/settings/general').label).toBe('General');
  });
});

describe('Settings → School year', () => {
  it('holds only the calendar: no email, WhatsApp, TV or class notes on this tab', async () => {
    mockApi();
    renderPage();
    await screen.findByText('2026-27');
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
    expect(screen.queryByText(/Reception TV/)).toBeNull();
    expect(screen.queryByText(/Class notes/)).toBeNull();
    expect(screen.queryByText(/letterhead/i)).toBeNull();
  });

  it('lists periods by bell time with their length, and no add form stands open', async () => {
    mockApi();
    renderPage();
    const list = await screen.findByRole('list', { name: 'Periods' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Period I'), expect.stringContaining('Period II'), expect.stringContaining('Break'),
    ]);
    expect(rows[0]).toHaveTextContent('45 min');
    expect(screen.queryByLabelText('Label')).toBeNull();
  });

  it('adds a year from a panel', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Add academic year/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), '2027-28');
    await user.type(within(dialog).getByLabelText('Start date'), '2027-04-01');
    await user.type(within(dialog).getByLabelText('End date'), '2028-03-31');
    await user.click(within(dialog).getByRole('button', { name: 'Add academic year' }));
    expect(api.post).toHaveBeenCalledWith('/manage/years', { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31', isCurrent: false });
  });

  it('tapping a period opens it in a panel and saves the change', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    renderPage();
    const list = await screen.findByRole('list', { name: 'Periods' });
    await user.click(within(list).getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');
    const label = within(dialog).getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Assembly');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(api.put).toHaveBeenCalledWith('/manage/periods/p1', { label: 'Assembly', startTime: '08:00', endTime: '08:45', kind: 'CLASS' });
  });

  it('a school day is one tap', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    renderPage();
    const sun = await screen.findByRole('button', { name: 'Sun' });
    await vi.waitFor(() => expect(sun).not.toBeDisabled());
    expect(sun).toHaveAttribute('aria-pressed', 'false');
    await user.click(sun);
    expect(api.put).toHaveBeenCalledWith('/manage/school/working-days', { workingDays: [1, 2, 3, 4, 5, 6, 7] });
  });

  it('a break starts where the day ends and is saved as a BREAK', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    renderPage();
    await screen.findByRole('list', { name: 'Periods' });
    await user.click(screen.getByRole('button', { name: /Add lunch/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Starts at')).toHaveValue('09:45');
    await user.click(within(dialog).getByRole('button', { name: 'Add lunch' }));
    expect(api.post).toHaveBeenCalledWith('/manage/periods', { label: 'Lunch', order: 4, startTime: '09:45', endTime: '10:15', kind: 'BREAK' });
  });
});
