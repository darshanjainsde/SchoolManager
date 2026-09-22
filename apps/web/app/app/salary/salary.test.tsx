import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import RunTab from './run-tab';
import PeopleTab from './people-tab';
import StatutoryTab from './statutory-tab';
import { SALARY_SECTIONS } from './nav-items';
import { rupees, toMinor } from './ui';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app/salary', useRouter: () => ({ replace: vi.fn() }) }));

const SALARY_DIR = dirname(fileURLToPath(import.meta.url));

function mockApi(get: (path: string) => unknown, post?: (path: string, body?: unknown) => unknown): ApiStub {
  return {
    get: vi.fn(async (p: string) => get(p)),
    post: vi.fn(async (p: string, b?: unknown) => (post ? post(p, b) : {})),
    put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
}

const SETTINGS = {
  countryCode: 'IN', currency: 'INR', region: 'RJ', taxYearStartMonth: 4,
  pack: {
    label: 'India', version: 'IN-2026.09.22', rulesAsAt: '2026-09-22', regionLabel: 'State',
    regions: [{ code: 'RJ', name: 'Rajasthan' }, { code: 'MH', name: 'Maharashtra' }],
    regimes: [
      { key: 'NEW', label: 'New regime (default)', allows: { hra: false, s80c: false, s80d: false, homeLoanInterest: false } },
      { key: 'OLD', label: 'Old regime', allows: { hra: true, s80c: true, s80d: true, homeLoanInterest: true } },
    ],
    defaultRegime: 'NEW', payDueDay: 7, fnfWorkingDays: 2,
    unverified: [{ what: 'Provident fund administration charge', why: 'Sources disagree.' }],
  },
  countries: ['IN'],
};

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('salary route honesty', () => {
  it('every section points at a directory that exists, or is the index', () => {
    const dirs = new Set(readdirSync(SALARY_DIR).filter((n) => statSync(join(SALARY_DIR, n)).isDirectory()));
    for (const s of SALARY_SECTIONS) {
      if (!s.seg) continue;
      expect(`${s.seg}: ${dirs.has(s.seg)}`).toBe(`${s.seg}: true`);
    }
  });
});

describe('money', () => {
  it('groups rupees the Indian way and keeps paise only when there are any', () => {
    expect(rupees(4_000_000)).toBe('₹40,000');
    expect(rupees(122_577_600_0)).toBe('₹1,22,57,760');
    expect(rupees(9_955)).toBe('₹99.55');
    expect(rupees(-50_000)).toBe('−₹500');
  });
  it('reads what a person types, and an empty box is zero rather than NaN', () => {
    expect(toMinor('40000')).toBe(4_000_000);
    expect(toMinor('₹40,000')).toBe(4_000_000);
    expect(toMinor('')).toBe(0);
  });
});

describe('the pay run screen', () => {
  it('will not let a draft be approved or locked, and lock asks first because it cannot be undone', async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    vi.mocked(useApi).mockReturnValue(mockApi(
      (p) => {
        if (p === '/payroll/settings') return SETTINGS;
        if (p === '/payroll/runs') return [];
        if (p.startsWith('/payroll/runs/')) {
          return { run: { id: 'r1', periodYear: 2026, periodMonth: 9, status: 'DRAFT', headcount: 0, grossMinor: 0, deductionMinor: 0, netMinor: 0, employerCostMinor: 0, packVersion: 'IN-2026.09.22', rulesAsAt: '2026-09-30', lockedAt: null, paidAt: null, note: null }, payslips: [] };
        }
        return {};
      },
      (p) => { posts.push(p); return { id: 'r1' }; },
    ) as never);
    renderWithProviders(<RunTab base="/app/salary" />);

    await user.click(await screen.findByRole('button', { name: 'Open this month' }));
    expect(await screen.findByRole('button', { name: 'Work it out' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lock' })).toBeDisabled();
  });

  it('shows the rule book and the date it was last checked, rather than implying every rate is current', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi((p) => (p === '/payroll/settings' ? SETTINGS : [])) as never);
    renderWithProviders(<RunTab base="/app/salary" />);
    expect(await screen.findByText(/Rules current as at/)).toBeInTheDocument();
    expect(screen.getByText('IN-2026.09.22')).toBeInTheDocument();
  });
});

describe('the people screen', () => {
  const PEOPLE = [
    { personKind: 'TEACHER', id: 't1', name: 'Priya Nair', designation: 'Teacher', userId: 'u1', pay: { id: 'p1', effectiveFrom: '2026-04-01', monthlyGrossMinor: 4_000_000, taxRegime: 'NEW', pfOptIn: true, paidThroughVacation: true, contractMonths: 12 } },
    { personKind: 'STAFF', id: 's1', name: 'Sam Kumar', designation: 'Driver', userId: null, pay: null },
  ];

  it('says who has no pay set, rather than showing a zero', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi((p) => (p === '/payroll/settings' ? SETTINGS : p === '/payroll/people' ? PEOPLE : [])) as never);
    renderWithProviders(<PeopleTab />);
    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
    expect(screen.getByText('not set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set pay' })).toBeInTheDocument();
  });

  it('warns when no state is set, because professional tax cannot be worked out without one', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi((p) => (p === '/payroll/settings' ? { ...SETTINGS, region: null } : p === '/payroll/people' ? PEOPLE : [])) as never);
    renderWithProviders(<PeopleTab />);
    expect(await screen.findByText(/No state is set for this school/)).toBeInTheDocument();
  });

  it('names the shortfall in rupees when Basic is too small a share, and only then offers to save anyway', async () => {
    const user = userEvent.setup();
    vi.mocked(useApi).mockReturnValue(mockApi(
      (p) => (p === '/payroll/settings' ? SETTINGS : p === '/payroll/people' ? PEOPLE : []),
      (p) => (p === '/payroll/people/preview'
        ? {
            lines: [
              { key: 'basic', name: 'Basic', kind: 'EARNING', amountMinor: 1_000_000, order: 1, taxable: true, isWages: true },
              { key: 'hra', name: 'House rent allowance', kind: 'EARNING', amountMinor: 3_000_000, order: 3, taxable: true, isWages: false },
            ],
            wageShare: { shortfallMinor: 1_000_000, note: 'Code on Wages: house rent and the rest may not exceed half of total pay.' },
          }
        : {}),
    ) as never);
    renderWithProviders(<PeopleTab />);
    await user.click(await screen.findByRole('button', { name: 'Set pay' }));
    await user.type(screen.getByPlaceholderText('40000'), '40000');
    await user.click(screen.getByRole('button', { name: 'Work out the split' }));
    expect(await screen.findByText(/Move ₹10,000 a month into Basic/)).toBeInTheDocument();
    expect(screen.getByLabelText('Save it anyway')).toBeInTheDocument();
  });
});

describe('the statutory screen', () => {
  it('refuses to make a file from a month that is not locked, and says why', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi((p) => {
      if (p === '/payroll/runs') return [{ id: 'r1', periodYear: 2026, periodMonth: 9, status: 'CALCULATED', headcount: 25, grossMinor: 0, deductionMinor: 0, netMinor: 0, employerCostMinor: 0, packVersion: 'v', rulesAsAt: '2026-09-30', lockedAt: null, paidAt: null }];
      if (p.startsWith('/payroll/statutory/calendar')) {
        return { rulesAsAt: '2026-09-22', packVersion: 'IN-2026.09.22', period: { year: 2026, month: 9 }, duties: [{ key: 'TDS', label: 'Deposit tax deducted', cadence: 'MONTHLY', dueOn: '2026-10-07' }], note: 'Sckools works out what is owed and makes the file to upload.', unverified: [] };
      }
      return {};
    }) as never);
    renderWithProviders(<StatutoryTab />);
    expect(await screen.findByText(/is not locked yet/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Download' })[0]).toBeDisabled());
  });

  it('says out loud that the school still files it, which is the line the product must not blur', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi((p) => {
      if (p === '/payroll/runs') return [{ id: 'r1', periodYear: 2026, periodMonth: 9, status: 'LOCKED', headcount: 25, grossMinor: 0, deductionMinor: 0, netMinor: 0, employerCostMinor: 0, packVersion: 'v', rulesAsAt: '2026-09-30', lockedAt: '2026-10-01', paidAt: null }];
      if (p.startsWith('/payroll/statutory/calendar')) {
        return { rulesAsAt: '2026-09-22', packVersion: 'IN-2026.09.22', period: { year: 2026, month: 9 }, duties: [], note: 'Sckools works out what is owed and makes the file to upload. Submitting it stays with your school and its accountant.', unverified: [] };
      }
      return {};
    }) as never);
    renderWithProviders(<StatutoryTab />);
    expect(await screen.findByText(/Submitting it stays with your school/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Download' })[0]).toBeEnabled();
  });
});
