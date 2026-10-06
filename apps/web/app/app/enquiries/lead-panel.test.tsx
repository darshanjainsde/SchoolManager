// apps/web/app/app/enquiries/lead-panel.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { LeadPanel } from './lead-panel';
import type { Lead } from './lead';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const BASE: Lead & { notes: [] } = {
  id: 'L1', parentName: 'Meera Purohit', childName: 'Aarav', phone: '+91 98290 11223', email: null,
  gradeInterest: 'Class III', message: null, status: 'CONTACTED', source: 'WALK_IN', whatsappOk: true,
  followUpAt: null, lastContactedAt: null, ownerUserId: 'u-gone', ownerName: 'Ravi Old', ownerOnDesk: false,
  lostReason: null, noteCount: 0, createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-01T05:00:00.000Z',
  notes: [],
};
const OWNERS = [
  { userId: 'u-off', name: 'Sunita Kale', job: 'ADMISSIONS' },
  { userId: 'u-adm', name: 'Principal Rathore', job: 'ADMIN' },
];

function mount(detail: Partial<Lead> = {}): ApiStub {
  const api: ApiStub = {
    get: vi.fn(async (path: string) => (path === '/site/enquiries/owners' ? OWNERS : { ...BASE, ...detail })),
    post: vi.fn().mockResolvedValue({}), put: vi.fn(), patch: vi.fn().mockResolvedValue({}), del: vi.fn(),
  };
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
  renderWithProviders(<LeadPanel id="L1" />);
  return api;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

// jsdom cannot follow tel: / wa.me links and logs "not implemented: navigation"
// for each; the click's handler has already run, so just stop the navigation.
const stopNavigation = (e: Event) => { if ((e.target as HTMLElement).closest('a')) e.preventDefault(); };
beforeEach(() => document.addEventListener('click', stopNavigation));
afterEach(() => document.removeEventListener('click', stopNavigation));

describe('the lead panel', () => {
  it('offers only the stages ahead', async () => {
    const api = mount();
    await screen.findByRole('heading', { name: 'Meera Purohit' });
    const stages = within(screen.getByRole('group', { name: 'Admissions stage' }));
    expect(stages.getByRole('button', { name: 'New — done' })).toBeDisabled();
    expect(stages.getByRole('button', { name: 'Contacted' })).toBeDisabled();
    expect(stages.getByRole('button', { name: 'Contacted' })).toHaveAttribute('aria-current', 'step');
    expect(stages.getByRole('button', { name: 'Interested' })).not.toHaveAttribute('aria-current');
    fireEvent.click(stages.getByRole('button', { name: 'Interested' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/site/enquiries/L1', { status: 'INTERESTED' }));
  });

  it('Call opens the dialler and asks how it went; "No answer" logs the call and nothing else', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: /^Call / }));
    const sheet = within(screen.getByRole('group', { name: 'How did it go?' }));
    fireEvent.click(sheet.getByRole('button', { name: 'No answer' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/site/enquiries/L1/notes', { kind: 'CALL', outcome: 'NO_ANSWER' }));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('"Lost" after a WhatsApp asks why before it logs', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: 'WhatsApp' }));
    const sheet = within(screen.getByRole('group', { name: 'How did it go?' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Lost' }));
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Why the family is not going ahead'), { target: { value: 'Fees too high' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Mark lost' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/site/enquiries/L1/notes', { kind: 'WHATSAPP', outcome: 'LOST', lostReason: 'Fees too high' }));
  });

  it('"Not now" closes the question and writes nothing', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: /^Call / }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('group', { name: 'How did it go?' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a lost lead is reopened, not clicked backwards', async () => {
    const api = mount({ status: 'LOST', lostReason: 'Too far' });
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/site/enquiries/L1', { status: 'CONTACTED' }));
  });

  it('the owner picker lists the desk, and names an owner who has left rather than showing "Nobody yet"', async () => {
    const api = mount();
    const picker = await screen.findByLabelText('Whose lead this is');
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Sunita Kale · Admissions' })).toBeInTheDocument());
    expect(within(picker).getByRole('option', { name: 'Ravi Old — no longer on the desk' })).toBeInTheDocument();
    expect((picker as HTMLSelectElement).value).toBe('u-gone');
    expect(api.get).not.toHaveBeenCalledWith('/manage/staff');
  });

  it('"Mark lost" after a WhatsApp stays disabled until a reason is typed, and posts it trimmed', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: 'WhatsApp' }));
    const sheet = within(screen.getByRole('group', { name: 'How did it go?' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Lost' }));
    const confirm = sheet.getByRole('button', { name: 'Mark lost' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why the family is not going ahead'), { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why the family is not going ahead'), { target: { value: '  Fees too high  ' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/site/enquiries/L1/notes', { kind: 'WHATSAPP', outcome: 'LOST', lostReason: 'Fees too high' }));
  });

  it('the Lost stage asks why: disabled for a blank or whitespace reason, then patches the trimmed one', async () => {
    const api = mount();
    const stages = within(await screen.findByRole('group', { name: 'Admissions stage' }));
    fireEvent.click(stages.getByRole('button', { name: 'Lost' }));
    expect(api.patch).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Mark lost' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why the lead was lost'), { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why the lead was lost'), { target: { value: '  Chose a nearer school ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/site/enquiries/L1', { status: 'LOST', lostReason: 'Chose a nearer school' }));
  });

  it('each change sends only that field — an owner, a date, never the whole lead', async () => {
    const api = mount({ ownerUserId: 'u-off', ownerName: 'Sunita Kale', ownerOnDesk: true });
    const picker = await screen.findByLabelText('Whose lead this is');
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Principal Rathore · Admin' })).toBeInTheDocument());
    fireEvent.change(picker, { target: { value: 'u-adm' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/site/enquiries/L1', { ownerUserId: 'u-adm' }));
    fireEvent.change(screen.getByLabelText('Ring them again on'), { target: { value: '2026-10-20' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/site/enquiries/L1', { followUpAt: '2026-10-20' }));
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it('shows the API’s reason inline when a write is refused', async () => {
    const api = mount();
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'That move is not allowed', { code: 'VALIDATION', message: 'That move is not allowed' }));
    const stages = within(await screen.findByRole('group', { name: 'Admissions stage' }));
    fireEvent.click(stages.getByRole('button', { name: 'Interested' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That move is not allowed');
  });

  it('on ENQUIRY_CHANGED says so, refetches the lead and refreshes the list', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const api = mount();
    const msg = 'Someone else just moved this lead. Refresh and try again.';
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, msg, { code: 'ENQUIRY_CHANGED', message: msg }));
    const stages = within(await screen.findByRole('group', { name: 'Admissions stage' }));
    const detailReads = () => (api.get as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '/site/enquiries/L1').length;
    expect(detailReads()).toBe(1);
    fireEvent.click(stages.getByRole('button', { name: 'Interested' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(msg);
    await waitFor(() => expect(detailReads()).toBe(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['site-enquiries'] });
  });

  it('on ENQUIRY_STAGE_BACKWARDS the lead is refetched and the list refreshed, as for ENQUIRY_CHANGED', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const api = mount();
    const msg = 'A lead cannot move back to an earlier stage.';
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, msg, { code: 'ENQUIRY_STAGE_BACKWARDS', message: msg }));
    const stages = within(await screen.findByRole('group', { name: 'Admissions stage' }));
    const detailReads = () => (api.get as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '/site/enquiries/L1').length;
    expect(detailReads()).toBe(1);
    fireEvent.click(stages.getByRole('button', { name: 'Interested' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(msg);
    await waitFor(() => expect(detailReads()).toBe(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['site-enquiries'] });
  });

  it('offers WhatsApp on a country-coded number, and none on a number that cannot be one', async () => {
    mount({ phone: '98290 11223' });
    expect(await screen.findByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/919829011223');
  });

  it('hides WhatsApp when the phone cannot be a number', async () => {
    mount({ phone: '123' });
    await screen.findByRole('heading', { name: 'Meera Purohit' });
    expect(screen.queryByRole('link', { name: 'WhatsApp' })).not.toBeInTheDocument();
  });

  it('a contact that loses the race also says so and refreshes', async () => {
    const api = mount();
    const msg = 'Someone else just moved this lead. Refresh and try again.';
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, msg, { code: 'ENQUIRY_CHANGED', message: msg }));
    fireEvent.click(await screen.findByRole('link', { name: /^Call / }));
    fireEvent.click(within(screen.getByRole('group', { name: 'How did it go?' })).getByRole('button', { name: 'Interested' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(msg);
    await waitFor(() => expect((api.get as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '/site/enquiries/L1')).toHaveLength(2));
    expect(screen.queryByRole('group', { name: 'How did it go?' })).not.toBeInTheDocument();
  });

  it('Escape puts the "how did it go?" question away and writes nothing', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: /^Call / }));
    expect(screen.getByRole('group', { name: 'How did it go?' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'How did it go?' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a refused "Mark lost" keeps the form and the typed reason; the reason field is capped at the 200 the API allows', async () => {
    const api = mount();
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'Reason is too long', { code: 'VALIDATION', message: 'Reason is too long' }));
    const stages = within(await screen.findByRole('group', { name: 'Admissions stage' }));
    fireEvent.click(stages.getByRole('button', { name: 'Lost' }));
    const why = screen.getByLabelText('Why the lead was lost') as HTMLInputElement;
    expect(why.maxLength).toBe(200);
    fireEvent.change(why, { target: { value: 'Too far' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark lost' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reason is too long');
    expect((screen.getByLabelText('Why the lead was lost') as HTMLInputElement).value).toBe('Too far');
  });

  it('the contact "why" field is capped at 200 too', async () => {
    mount();
    fireEvent.click(await screen.findByRole('link', { name: 'WhatsApp' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'How did it go?' })).getByRole('button', { name: 'Lost' }));
    expect((screen.getByLabelText('Why the family is not going ahead') as HTMLInputElement).maxLength).toBe(200);
  });

  it('Enter in the note box is ignored while the note is still being saved', async () => {
    const api = mount();
    let release!: (v: unknown) => void;
    (api.post as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => { release = r; }));
    const box = await screen.findByLabelText('Add a note');
    fireEvent.change(box, { target: { value: 'Rang, will visit Saturday' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/site/enquiries/L1/notes', { body: 'Rang, will visit Saturday' });
    release({});
  });
});
