import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import MonthTab from './month-tab';
import PeopleTab from './people-tab';
import GradesTab from './grades-tab';
import FilingsTab from './filings-tab';
import { PAY_SECTIONS } from './nav-items';
import { rupees, toMinor } from './ui';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app/pay', useRouter: () => ({ replace: vi.fn() }) }));

const PAY_DIR = dirname(fileURLToPath(import.meta.url));

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

const GRADE = {
  id: 'g1', name: 'TGT', description: 'Trained Graduate Teacher',
  bandMinMinor: 3_000_000, bandMaxMinor: 4_600_000, overrides: {},
  order: 10, active: true, note: null,
  headcount: 2, monthlyMinor: 7_600_000,
  split: [
    { key: 'basic', name: 'Basic', amountMinor: 1_900_000 },
    { key: 'hra', name: 'House rent allowance', amountMinor: 760_000 },
    { key: 'special', name: 'Special allowance', amountMinor: 1_140_000 },
  ],
  wageShareNote: null, overshootMinor: 0,
};

/** A school that is fully set up, so the home screen shows the month. */
const OVERVIEW = {
  setup: { countryCode: 'IN', gradeCount: 1, rosterSize: 3, onPay: 2, notOnPay: 1, ready: true },
  period: { year: 2026, month: 9 },
  run: null,
  cost: {
    estimated: true, headcount: 2, grossMinor: 7_600_000, deductionMinor: 180_000,
    netMinor: 7_420_000, employerCostMinor: 360_000, totalCostMinor: 7_960_000,
  },
  previousTotalMinor: 7_900_000,
  exceptions: [
    { kind: 'NO_PAY', count: 1, label: 'Sam Kumar has no pay set', names: ['Sam Kumar'], goTo: 'people' },
  ],
  recent: [],
};

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('pay route honesty', () => {
  it('every section points at a directory that exists, or is the index', () => {
    const dirs = new Set(readdirSync(PAY_DIR).filter((n) => statSync(join(PAY_DIR, n)).isDirectory()));
    for (const s of PAY_SECTIONS) {
      if (!s.seg) continue;
      expect(`${s.seg}: ${dirs.has(s.seg)}`).toBe(`${s.seg}: true`);
    }
  });
});

describe('money', () => {
  it('groups rupees the Indian way and keeps paise only when there are any', () => {
    expect(rupees(4_000_000)).toBe('₹40,000');
    expect(rupees(225_776_00)).toBe('₹2,25,776');
    expect(rupees(4_000_050)).toBe('₹40,000.50');
    expect(rupees(-4_000_000)).toBe('−₹40,000');
  });

  it('reads what a person types, and an empty box is zero rather than NaN', () => {
    expect(toMinor('40000')).toBe(4_000_000);
    expect(toMinor('₹40,000')).toBe(4_000_000);
    expect(toMinor('')).toBe(0);
  });
});

describe('the home screen', () => {
  const api = (o: unknown = OVERVIEW) => mockApi((p) => {
    if (p === '/payroll/settings') return SETTINGS;
    if (p === '/payroll/overview') return o;
    return [];
  });

  it('leads with what the month costs the school, not with what is paid out', async () => {
    // Gross plus the school's own contributions. It is the figure a trustee
    // asks for and the one no payroll screen ever shows.
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<MonthTab base="/app/pay" />);

    expect(await screen.findByText('₹79,600')).toBeInTheDocument();
    expect(screen.getByText(/What September will cost the school/)).toBeInTheDocument();
  });

  it('never asks which month to open', async () => {
    // The old screen opened on a month picker above "No month has been run
    // yet" — a question asked before the room had said what it was for. There
    // is always exactly one month that wants running.
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<MonthTab base="/app/pay" />);

    await screen.findByText('₹79,600');
    expect(screen.queryByLabelText('Month')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument();
  });

  it('names who is blocking the month and where to fix it, not just a count', async () => {
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<MonthTab base="/app/pay" />);

    expect(await screen.findByText('Sam Kumar has no pay set')).toBeInTheDocument();
    // A warning that states the discrepancy without the move that fixes it
    // leaves the reader to work out which control resolves it.
    expect(screen.getByRole('link', { name: 'Open People' })).toHaveAttribute('href', '/app/pay/people');
  });

  it('shows a path rather than a month when the school has not set Pay up', async () => {
    vi.mocked(useApi).mockReturnValue(api({
      ...OVERVIEW,
      setup: { countryCode: 'IN', gradeCount: 0, rosterSize: 48, onPay: 0, notOnPay: 48, ready: false },
      exceptions: [],
    }) as never);
    renderWithProviders(<MonthTab base="/app/pay" />);

    expect(await screen.findByText('Make your grades')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft my grades' })).toHaveAttribute('href', '/app/pay/grades');
    expect(screen.queryByText(/costs the school/)).not.toBeInTheDocument();
  });

  it('says a figure is an estimate while it still is one', async () => {
    // The alternative — printing a confident total before anything has been
    // worked out — is the kind of copy that stops anyone looking for the gap.
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<MonthTab base="/app/pay" />);
    expect(await screen.findByText(/from the pay you have agreed, before tax is worked out/)).toBeInTheDocument();
  });

  it('shows the rule book and the date it was last checked, rather than implying every rate is current', async () => {
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<MonthTab base="/app/pay" />);
    expect(await screen.findByText(/Rules current as at/)).toBeInTheDocument();
    expect(screen.getByText('IN-2026.09.22')).toBeInTheDocument();
  });
});

describe('the people screen', () => {
  const PEOPLE = [
    {
      personKind: 'TEACHER', id: 't1', name: 'Priya Nair', designation: 'Teacher', userId: 'u1',
      pay: { id: 'p1', effectiveFrom: '2026-04-01', monthlyGrossMinor: 3_800_000, payGradeId: 'g1', taxRegime: 'NEW', pfOptIn: true, paidThroughVacation: true, contractMonths: 12, hasBank: true },
    },
    { personKind: 'STAFF', id: 's1', name: 'Sam Kumar', designation: 'Driver', userId: null, pay: null },
  ];
  const api = (post?: (p: string, b?: unknown) => unknown) => mockApi((p) => {
    if (p === '/payroll/settings') return SETTINGS;
    if (p === '/payroll/people') return PEOPLE;
    if (p === '/payroll/grades') return [GRADE];
    return [];
  }, post);

  it('puts the people who are blocking you at the top, not in alphabetical order', async () => {
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<PeopleTab base="/app/pay" />);

    await screen.findByText('Priya Nair');
    const headings = screen.getAllByText(/^(Not on pay yet|TGT)$/).map((n) => n.textContent);
    expect(headings[0]).toBe('Not on pay yet');
  });

  it('says who has no pay set, rather than showing a zero', async () => {
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<PeopleTab base="/app/pay" />);

    expect(await screen.findByText('Sam Kumar')).toBeInTheDocument();
    expect(screen.getByText('no pay set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set pay' })).toBeInTheDocument();
  });

  it('opens the editor in a dialog rather than below the table', async () => {
    // THE DEFECT THIS REPLACES. The editor used to render after the people
    // card, so on a real roster "Set pay" opened it past the fold and the
    // button looked dead — which is how the tab came to feel broken.
    const user = userEvent.setup();
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<PeopleTab base="/app/pay" />);

    await user.click(await screen.findByRole('button', { name: 'Set pay' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sam Kumar')).toBeInTheDocument();
  });

  it('asks for a grade and a figure, and nothing else, to put someone on pay', async () => {
    // THE SECOND DEFECT. It used to want gross, conveyance, dearness
    // allowance, a preview click and a save before anything was stored. The
    // shipped components already split 50/20/30 and already satisfy the
    // wage-share rule, so the rest has a working default.
    const user = userEvent.setup();
    const sent: { path: string; body?: unknown }[] = [];
    vi.mocked(useApi).mockReturnValue(api((path, body) => {
      sent.push({ path, body });
      return path === '/payroll/people/preview' ? { lines: [], wageShare: null, overshootMinor: 0 } : {};
    }) as never);
    renderWithProviders(<PeopleTab base="/app/pay" />);

    await user.click(await screen.findByRole('button', { name: 'Set pay' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('35000'), '18000');
    await user.click(within(dialog).getByRole('button', { name: 'Put on pay' }));

    await waitFor(() => {
      const save = sent.find((s) => s.path === '/payroll/people/structure');
      expect(save).toBeTruthy();
      expect(save!.body).toMatchObject({ personId: 's1', monthlyGrossMinor: 1_800_000, payGradeId: 'g1' });
    });
  });

  it('shows take-home beside the figure while it is being typed', async () => {
    // A principal agreeing "thirty-five thousand" means take-home; payroll
    // means gross. That argument otherwise happens on the 1st, when nothing
    // can be changed.
    const user = userEvent.setup();
    vi.mocked(useApi).mockReturnValue(api((p) => (p === '/payroll/people/preview'
      ? {
          lines: [
            { key: 'basic', name: 'Basic', kind: 'EARNING', amountMinor: 1_750_000, order: 1, taxable: true, isWages: true },
            { key: 'hra', name: 'House rent allowance', kind: 'EARNING', amountMinor: 700_000, order: 3, taxable: true, isWages: false },
          ],
          wageShare: null, overshootMinor: 0,
        }
      : {})) as never);
    renderWithProviders(<PeopleTab base="/app/pay" />);

    await user.click(await screen.findByRole('button', { name: 'Set pay' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('35000'), '35000');
    expect(await within(dialog).findByText('Takes home about')).toBeInTheDocument();
    expect(within(dialog).getByText('₹24,500')).toBeInTheDocument();
  });

  it('names the shortfall when Basic is too small a share, and only then offers to save anyway', async () => {
    const user = userEvent.setup();
    vi.mocked(useApi).mockReturnValue(api((p) => (p === '/payroll/people/preview'
      ? {
          lines: [{ key: 'basic', name: 'Basic', kind: 'EARNING', amountMinor: 1_000_000, order: 1, taxable: true, isWages: true }],
          wageShare: { shortfallMinor: 1_000_000, note: 'Code on Wages: house rent and the rest may not exceed half of total pay.' }, overshootMinor: 0,
        }
      : {})) as never);
    renderWithProviders(<PeopleTab base="/app/pay" />);

    await user.click(await screen.findByRole('button', { name: 'Set pay' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('35000'), '40000');
    expect(await within(dialog).findByText(/Code on Wages/)).toBeInTheDocument();
    expect(within(dialog).getByText(/taking the risk/)).toBeInTheDocument();
  });
});

describe('the grades screen', () => {
  const api = (grades: unknown[] = [GRADE], post?: (p: string, b?: unknown) => unknown) => mockApi((p) => {
    if (p === '/payroll/settings') return SETTINGS;
    if (p === '/payroll/grades') return grades;
    if (p === '/payroll/grades/suggest') {
      return [{ name: 'PRT', description: 'Primary Teacher', bandMinMinor: 2_000_000, bandMaxMinor: 3_000_000, order: 10, headcount: 7, onPay: 3 }];
    }
    return [];
  }, post);

  it('shows a grade with its band, its headcount and what it costs', async () => {
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<GradesTab base="/app/pay" />);

    expect(await screen.findByText('TGT')).toBeInTheDocument();
    expect(screen.getByText('Trained Graduate Teacher')).toBeInTheDocument();
    expect(screen.getByText('₹30,000')).toBeInTheDocument();
    expect(screen.getByText('₹46,000')).toBeInTheDocument();
    expect(screen.getByText('2 people')).toBeInTheDocument();
  });

  it('drafts grades from the roll when there are none, and saves nothing until asked', async () => {
    vi.mocked(useApi).mockReturnValue(api([]) as never);
    renderWithProviders(<GradesTab base="/app/pay" />);

    expect(await screen.findByText('Drafted from your roll')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is saved until you add them/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add all 1' })).toBeInTheDocument();
  });

  it('raises a whole grade in one action, from one date', async () => {
    // The April job. Without this it is one edit per person on the grade.
    const user = userEvent.setup();
    const sent: { path: string; body?: unknown }[] = [];
    vi.mocked(useApi).mockReturnValue(api([GRADE], (path, body) => { sent.push({ path, body }); return {}; }) as never);
    renderWithProviders(<GradesTab base="/app/pay" />);

    await user.click(await screen.findByRole('button', { name: 'Raise this grade' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Raise 2 people' }));

    await waitFor(() => {
      const raise = sent.find((s) => s.path === '/payroll/grades/raise');
      expect(raise).toBeTruthy();
      expect(raise!.body).toMatchObject({ gradeId: 'g1', percentBps: 500 });
    });
  });

  it('says a band only ever warns, because a school may pay what it has agreed', async () => {
    const user = userEvent.setup();
    vi.mocked(useApi).mockReturnValue(api() as never);
    renderWithProviders(<GradesTab base="/app/pay" />);

    await user.click(await screen.findByRole('button', { name: 'Add a grade' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Paying outside it is allowed and only ever warns/)).toBeInTheDocument();
  });
});

describe('the filings screen', () => {
  it('refuses to make a file from a month that is not locked, and says why', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi((p) => {
      if (p === '/payroll/runs') return [{ id: 'r1', periodYear: 2026, periodMonth: 9, status: 'CALCULATED', headcount: 25, grossMinor: 0, deductionMinor: 0, netMinor: 0, employerCostMinor: 0, packVersion: 'v', rulesAsAt: '2026-09-30', lockedAt: null, paidAt: null }];
      if (p.startsWith('/payroll/statutory/calendar')) {
        return { rulesAsAt: '2026-09-22', packVersion: 'IN-2026.09.22', period: { year: 2026, month: 9 }, duties: [{ key: 'TDS', label: 'Deposit tax deducted', cadence: 'MONTHLY', dueOn: '2026-10-07' }], note: 'Sckools works out what is owed and makes the file to upload.', unverified: [] };
      }
      return {};
    }) as never);
    renderWithProviders(<FilingsTab />);
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
    renderWithProviders(<FilingsTab />);
    expect(await screen.findByText(/Submitting it stays with your school/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Download' })[0]).toBeEnabled();
  });
});
