/** The `/payroll/*` shapes, typed at the call site the way the other consoles do. */
export interface PayLine { key: string; name: string; kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST'; amountMinor: number; order: number }

export interface SalarySettings {
  countryCode: string;
  currency: string;
  region: string | null;
  taxYearStartMonth: number;
  pack: {
    label: string; version: string; rulesAsAt: string; regionLabel: string;
    regions: { code: string; name: string }[];
    regimes: { key: 'NEW' | 'OLD'; label: string; allows: { hra: boolean; s80c: boolean; s80d: boolean; homeLoanInterest: boolean } }[];
    defaultRegime: 'NEW' | 'OLD';
    payDueDay: number; fnfWorkingDays: number;
    unverified: { what: string; why: string }[];
  };
  countries: string[];
}

export interface Component {
  id: string; key: string; name: string; kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST';
  calc: 'FIXED' | 'PCT_OF_BASIC' | 'PCT_OF_GROSS' | 'BALANCE';
  rateBps: number | null; taxable: boolean; isWages: boolean; retirementBase: boolean;
  healthBase: boolean; gratuityBase: boolean; prorate: boolean; order: number; active: boolean; hint: string | null;
}

export interface Person {
  personKind: 'TEACHER' | 'STAFF';
  id: string;
  name: string;
  designation: string | null;
  userId: string | null;
  pay: {
    id: string; effectiveFrom: string; monthlyGrossMinor: number;
    payGradeId: string | null;
    taxRegime: 'NEW' | 'OLD'; pfOptIn: boolean; paidThroughVacation: boolean; contractMonths: number;
    hasBank: boolean;
  } | null;
}

export interface GradeOverride { rateBps?: number; fixedMinor?: number }

export interface Grade {
  id: string;
  name: string;
  description: string | null;
  bandMinMinor: number;
  bandMaxMinor: number;
  overrides: Record<string, GradeOverride>;
  order: number;
  active: boolean;
  note: string | null;
  headcount: number;
  monthlyMinor: number;
  split: { key: string; name: string; amountMinor: number }[];
  wageShareNote: string | null;
  overshootMinor: number;
}

export interface SuggestedGrade {
  name: string; description: string;
  bandMinMinor: number; bandMaxMinor: number;
  order: number; headcount: number; onPay: number;
}

export type ExceptionKind = 'NO_GRADE' | 'NO_PAY' | 'NO_BANK' | 'OUT_OF_BAND' | 'ARREARS';

export interface PayException {
  kind: ExceptionKind;
  count: number;
  label: string;
  names: string[];
  goTo: 'people' | 'grades';
}

export interface Overview {
  setup: {
    countryCode: string; gradeCount: number; rosterSize: number;
    onPay: number; notOnPay: number; ready: boolean;
  };
  period: { year: number; month: number };
  run: {
    id: string; status: string; headcount: number;
    grossMinor: number; deductionMinor: number; netMinor: number; employerCostMinor: number;
  } | null;
  cost: {
    estimated: boolean; headcount: number; grossMinor: number; deductionMinor: number;
    netMinor: number; employerCostMinor: number; totalCostMinor: number;
  };
  previousTotalMinor: number | null;
  exceptions: PayException[];
  recent: {
    id: string; periodYear: number; periodMonth: number; status: string;
    headcount: number; grossMinor: number; employerCostMinor: number; netMinor: number;
  }[];
}

export interface RunRow {
  id: string; periodYear: number; periodMonth: number; status: string; headcount: number;
  grossMinor: number; deductionMinor: number; netMinor: number; employerCostMinor: number;
  packVersion: string; rulesAsAt: string; lockedAt: string | null; paidAt: string | null;
}

export interface Payslip {
  id: string; personKind: 'TEACHER' | 'STAFF'; teacherId: string | null; staffId: string | null;
  name: string; designation: string | null; lines: PayLine[];
  daysInMonth: number; daysPaid: number;
  grossMinor: number; deductionMinor: number; netMinor: number; employerCostMinor: number;
  retirementEmployeeMinor: number; retirementEmployerMinor: number; pensionMinor: number;
  healthEmployeeMinor: number; healthEmployerMinor: number; localTaxMinor: number; incomeTaxMinor: number;
  taxRegime: 'NEW' | 'OLD'; ytdGrossMinor: number; ytdTaxMinor: number;
}

export interface RunDetail { run: RunRow & { note: string | null }; payslips: Payslip[] }

export interface CalcResult {
  headcount: number; grossMinor: number; deductionMinor: number; netMinor: number;
  employerCostMinor: number; rulesAsAt: string; packVersion: string; taxYear: string; notes: string[];
}

export interface PreviewResult {
  lines: (PayLine & { taxable: boolean; isWages: boolean })[];
  wageShare: { shortfallMinor: number; note: string } | null;
  /** Above zero when the split's parts add to more than the pay agreed. */
  overshootMinor: number;
}

export interface Duty { key: string; label: string; cadence: string; dueOn: string | null; note?: string }
export interface Calendar {
  rulesAsAt: string; packVersion: string; period: { year: number; month: number };
  duties: Duty[]; note: string; unverified: { what: string; why: string }[];
}

export interface AdminAccess { id: string; name: string | null; email: string; canSeeSalary: boolean; createdAt: string }
export interface Adjustment {
  id: string; personKind: 'TEACHER' | 'STAFF'; teacherId: string | null; staffId: string | null;
  periodYear: number; periodMonth: number; label: string; kind: 'EARNING' | 'DEDUCTION';
  amountMinor: number; taxable: boolean; lopDays: number; note: string | null;
}
