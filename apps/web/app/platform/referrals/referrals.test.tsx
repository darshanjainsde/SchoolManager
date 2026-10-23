import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import ReferralsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROMOTER = { id: 'p1', code: 'PRIYA18', name: 'Priya Sharma', email: 'priya@example.com', phoneE164: null, city: 'Kota', status: 'ACTIVE', statusReason: null, who: 'Parent, PTA member', expect: '3-5', areas: 'Kota', know: 'On the PTA of two schools.', schoolsInMind: null, hasGst: false, commissionPct: null, commissionCapMinor: null, commissionNote: null, commissionSetAt: null, payeeName: null, panMasked: null, bankAccountMasked: null, ifsc: null, upi: null, gstin: null, payoutDetailsAt: null, kycVerifiedAt: null, createdAt: '2026-10-20T00:00:00Z', referred: 1, live: 0, earnedMinor: 0, paidMinor: 0, openTasks: ['COMMISSION'] };
const REFERRAL = { id: 'r5', schoolName: 'Green Valley School', city: 'Kota', area: 'Talwandi', studentsApprox: 1100, contactName: 'Mrs Singh', contactRole: 'Principal', contactPhone: '98555 66778', contactEmail: null, planInterest: 'Pro', howKnown: 'PTA', consent: true, viaLink: false, status: 'LOGGED', statusReason: null, attributionUntil: '2027-01-20T00:00:00Z', lapsed: false, invoiceMinor: null, rewardMinor: null, createdAt: '2026-10-22T00:00:00Z', leadId: null, promoter: { id: 'p1', name: 'Priya Sharma', code: 'PRIYA18', commissionPct: null, commissionCapMinor: null }, payout: null, events: [] };
const TASKS = [
  { id: 't1', kind: 'COMMISSION', createdAt: '2026-10-21T00:00:00Z', note: null, promoter: PROMOTER, referral: null, suggestedPct: 10, suggestedCapMinor: 50_000_00, duplicate: null, lapsed: false },
  { id: 't2', kind: 'REFERRAL', createdAt: '2026-10-22T00:00:00Z', note: null, promoter: PROMOTER, referral: REFERRAL, suggestedPct: null, suggestedCapMinor: 50_000_00, duplicate: { kind: 'lead', on: '2026-09-01T00:00:00Z' }, lapsed: false },
];

function stub() {
  const api = {
    get: vi.fn((path: string) => {
      if (path === '/owner/referrals/tasks') return Promise.resolve(TASKS);
      if (path.startsWith('/owner/referrals/payouts')) return Promise.resolve([]);
      if (path.startsWith('/owner/referrals/promoters')) return Promise.resolve([PROMOTER]);
      if (path === '/owner/referrals/settings') return Promise.resolve({ ladder: { '1-2': 8, '3-5': 10, '6-10': 12, '10+': 15 }, capMinor: 50_000_00, payoutDays: 30, attributionDays: 90, tdsPct: 2 });
      if (path.startsWith('/owner/referrals')) return Promise.resolve([REFERRAL]);
      return Promise.resolve([]);
    }),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn(),
  };
  (useApi as unknown as ReturnType<typeof vi.fn>).mockReturnValue(api);
  return api;
}

beforeEach(() => { useAuthStore.setState({ status: 'authed', audience: 'platform' }); });

describe('owner console · Referrals', () => {
  it('opens on Tasks: the questionnaire beside a rate box pre-filled from the ladder, and sets the rate in paise', async () => {
    const api = stub();
    renderWithProviders(<ReferralsPage />);
    expect(await screen.findByText('Commission request')).toBeInTheDocument();
    expect(screen.getByText('On the PTA of two schools.')).toBeInTheDocument();
    const pct = screen.getByLabelText('Commission %') as HTMLInputElement;
    expect(pct.value).toBe('10');
    fireEvent.change(pct, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set commission' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/owner/referrals/promoters/p1/commission', { pct: 12, capMinor: 50_000_00, note: undefined }));
  });

  it('a referral task shows the real duplicate verdict and will not accept over it', async () => {
    stub();
    renderWithProviders(<ReferralsPage />);
    expect(await screen.findByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText(/already in your lead pipeline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject with reason' })).toBeDisabled(); // until a reason is typed
  });

  it('the Referrals tab lists every referral with its promoter and a forward move only', async () => {
    const api = stub();
    renderWithProviders(<ReferralsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^Referrals/ }));
    expect(await screen.findByText('Green Valley School')).toBeInTheDocument();
    expect(screen.getByText('rate not set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '→ Accepted' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/owner/referrals/r5/accept', {}));
  });

  it('the Settings tab reads the ladder and saves it in paise', async () => {
    const api = stub();
    renderWithProviders(<ReferralsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const cap = (await screen.findByLabelText('Default cap per school (₹, 0 = none)')) as HTMLInputElement;
    expect(cap.value).toBe('50000');
    fireEvent.change(cap, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/referrals/settings', expect.objectContaining({ capMinor: 0, tdsPct: 2 })));
  });
});
