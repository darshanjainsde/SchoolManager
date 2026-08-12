import {
  computeFine,
  DUE_SOON_WINDOW_DAYS,
  evaluateIssue,
  evaluateRenew,
  holdShelfExpiry,
  holdState,
  loanState,
  nextHoldToPromote,
  type Copy,
  type Hold,
  type HoldStatusValue,
  type Loan,
  type Member,
  type Policy,
} from './policy';

const MS_PER_DAY = 86_400_000;

const POLICY: Policy = {
  maxBooks: 3,
  loanDays: 14,
  renewLimit: 2,
  renewDays: 7,
  finePerDay: 5,
  graceDays: 2,
  maxFine: 200,
  maxHolds: 2,
  holdShelfDays: 3,
  maxOutstandingFine: 100,
};

const NOW = new Date('2026-08-11T10:00:00.000Z');

const ACTIVE_MEMBER: Member = { id: 'member-1', status: 'ACTIVE', homeBranchId: 'branch-1' };
const AVAILABLE_COPY: Copy = { status: 'AVAILABLE', branchId: 'branch-1' };

describe('evaluateIssue', () => {
  // Table-driven: each row isolates exactly one violation (every other input
  // is a "would otherwise pass" baseline), plus the two success boundaries.
  const cases: Array<{
    name: string;
    member?: Partial<Member>;
    copy?: Partial<Copy>;
    openLoans?: number;
    openFineTotal?: number;
    expect: { allowed: true } | { allowed: false; reason: string };
  }> = [
    {
      name: 'a member at exactly maxBooks is denied',
      openLoans: POLICY.maxBooks,
      expect: { allowed: false, reason: 'MEMBER_LIMIT_REACHED' },
    },
    {
      name: 'a member one below maxBooks is allowed',
      openLoans: POLICY.maxBooks - 1,
      expect: { allowed: true },
    },
    {
      name: 'a suspended member is denied',
      member: { status: 'SUSPENDED' },
      expect: { allowed: false, reason: 'MEMBER_NOT_ACTIVE' },
    },
    {
      name: 'a pending (never-activated) member is denied',
      member: { status: 'PENDING' },
      expect: { allowed: false, reason: 'MEMBER_NOT_ACTIVE' },
    },
    {
      name: 'a copy ON_HOLD_SHELF for a different member is denied',
      copy: { status: 'ON_HOLD_SHELF', heldForMemberId: 'someone-else' },
      expect: { allowed: false, reason: 'COPY_ON_HOLD_FOR_OTHER' },
    },
    {
      name: 'a copy ON_HOLD_SHELF for THIS member is allowed',
      copy: { status: 'ON_HOLD_SHELF', heldForMemberId: ACTIVE_MEMBER.id },
      expect: { allowed: true },
    },
    {
      name: 'a copy that is ON_LOAN is denied as not available',
      copy: { status: 'ON_LOAN' },
      expect: { allowed: false, reason: 'COPY_NOT_AVAILABLE' },
    },
    {
      name: 'a copy that is LOST is denied as not available',
      copy: { status: 'LOST' },
      expect: { allowed: false, reason: 'COPY_NOT_AVAILABLE' },
    },
    {
      name: 'fines at exactly maxOutstandingFine deny',
      openFineTotal: POLICY.maxOutstandingFine!,
      expect: { allowed: false, reason: 'OUTSTANDING_FINES_EXCEED_LIMIT' },
    },
    {
      name: 'fines one below maxOutstandingFine allow',
      openFineTotal: POLICY.maxOutstandingFine! - 1,
      expect: { allowed: true },
    },
    {
      name: 'a null maxOutstandingFine never denies on fines, however large',
      openFineTotal: 1_000_000,
      expect: { allowed: true },
    },
    {
      name: 'a copy at a different branch than the member\'s home branch is denied',
      copy: { branchId: 'branch-2' },
      expect: { allowed: false, reason: 'BRANCH_MISMATCH' },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const member: Member = { ...ACTIVE_MEMBER, ...c.member };
      const copy: Copy = { ...AVAILABLE_COPY, ...c.copy };
      const policy: Policy = c.name.includes('null maxOutstandingFine')
        ? { ...POLICY, maxOutstandingFine: null }
        : POLICY;
      const result = evaluateIssue(policy, member, copy, c.openLoans ?? 0, c.openFineTotal ?? 0, NOW);
      if (c.expect.allowed) {
        expect(result.allowed).toBe(true);
      } else {
        expect(result).toEqual({ allowed: false, reason: c.expect.reason });
      }
    });
  }

  it('a successful issue sets dueAt to now + loanDays', () => {
    const result = evaluateIssue(POLICY, ACTIVE_MEMBER, AVAILABLE_COPY, 0, 0, NOW);
    expect(result).toEqual({ allowed: true, dueAt: new Date(NOW.getTime() + POLICY.loanDays * MS_PER_DAY) });
  });

  it('checks precedence: an inactive member is denied even when every other input also violates a rule', () => {
    const result = evaluateIssue(
      POLICY,
      { ...ACTIVE_MEMBER, status: 'SUSPENDED' },
      { ...AVAILABLE_COPY, status: 'LOST', branchId: 'branch-2' },
      POLICY.maxBooks,
      POLICY.maxOutstandingFine!,
      NOW,
    );
    expect(result).toEqual({ allowed: false, reason: 'MEMBER_NOT_ACTIVE' });
  });
});

describe('evaluateRenew', () => {
  const OK_LOAN: Loan = { dueAt: new Date(NOW.getTime() + 3 * MS_PER_DAY), returnedAt: null, renewCount: 0 };

  it('renewal is refused when the title has pending holds', () => {
    const result = evaluateRenew(POLICY, OK_LOAN, 1, NOW);
    expect(result).toEqual({ allowed: false, reason: 'HAS_HOLDS' });
  });

  it('renewal is allowed when there are no pending holds on the title', () => {
    const result = evaluateRenew(POLICY, OK_LOAN, 0, NOW);
    expect(result).toEqual({ allowed: true, newDueAt: new Date(NOW.getTime() + POLICY.renewDays * MS_PER_DAY) });
  });

  it('renewal is refused at renewLimit', () => {
    const result = evaluateRenew(POLICY, { ...OK_LOAN, renewCount: POLICY.renewLimit }, 0, NOW);
    expect(result).toEqual({ allowed: false, reason: 'RENEW_LIMIT' });
  });

  it('renewal is allowed one below renewLimit', () => {
    const result = evaluateRenew(POLICY, { ...OK_LOAN, renewCount: POLICY.renewLimit - 1 }, 0, NOW);
    expect(result.allowed).toBe(true);
  });

  it('renewal is refused once the loan is already overdue', () => {
    const overdue: Loan = { ...OK_LOAN, dueAt: new Date(NOW.getTime() - 1) };
    const result = evaluateRenew(POLICY, overdue, 0, NOW);
    expect(result).toEqual({ allowed: false, reason: 'ALREADY_OVERDUE' });
  });

  it('a loan due at exactly now is not yet overdue and may still be renewed', () => {
    const result = evaluateRenew(POLICY, { ...OK_LOAN, dueAt: NOW }, 0, NOW);
    expect(result.allowed).toBe(true);
  });

  it('checks precedence: overdue wins even when renewLimit and holds are also violated', () => {
    const overdue: Loan = { ...OK_LOAN, dueAt: new Date(NOW.getTime() - 1), renewCount: POLICY.renewLimit };
    const result = evaluateRenew(POLICY, overdue, 5, NOW);
    expect(result).toEqual({ allowed: false, reason: 'ALREADY_OVERDUE' });
  });
});

describe('computeFine', () => {
  const dueAt = new Date('2026-08-01T00:00:00.000Z');

  it('graceDays fully absorbed produces a zero fine', () => {
    const at = new Date(dueAt.getTime() + POLICY.graceDays * MS_PER_DAY);
    expect(computeFine(POLICY, dueAt, at)).toEqual({ days: 0, amount: 0 });
  });

  it('one day past grace produces exactly finePerDay', () => {
    const at = new Date(dueAt.getTime() + (POLICY.graceDays + 1) * MS_PER_DAY);
    expect(computeFine(POLICY, dueAt, at)).toEqual({ days: 1, amount: POLICY.finePerDay });
  });

  it('not yet due (at before dueAt) produces a zero fine', () => {
    const at = new Date(dueAt.getTime() - MS_PER_DAY);
    expect(computeFine(POLICY, dueAt, at)).toEqual({ days: 0, amount: 0 });
  });

  it('at exactly dueAt produces a zero fine', () => {
    expect(computeFine(POLICY, dueAt, dueAt)).toEqual({ days: 0, amount: 0 });
  });

  it('maxFine caps a long overdue', () => {
    // 100 days overdue, well past grace: uncapped amount would be far above maxFine.
    const at = new Date(dueAt.getTime() + 100 * MS_PER_DAY);
    const uncappedDays = 100 - POLICY.graceDays;
    expect(uncappedDays * POLICY.finePerDay).toBeGreaterThan(POLICY.maxFine!);
    expect(computeFine(POLICY, dueAt, at)).toEqual({ days: uncappedDays, amount: POLICY.maxFine });
  });

  it('a null maxFine never caps, however large the overdue amount', () => {
    const uncapped: Policy = { ...POLICY, maxFine: null };
    const at = new Date(dueAt.getTime() + 100 * MS_PER_DAY);
    const days = 100 - POLICY.graceDays;
    expect(computeFine(uncapped, dueAt, at)).toEqual({ days, amount: days * POLICY.finePerDay });
  });
});

describe('loanState', () => {
  const dueAt = new Date('2026-08-11T00:00:00.000Z');

  it('a loan with returnedAt set is RETURNED regardless of now', () => {
    const loan: Pick<Loan, 'dueAt' | 'returnedAt'> = { dueAt, returnedAt: new Date('2026-08-01T00:00:00.000Z') };
    expect(loanState(loan, new Date('2030-01-01T00:00:00.000Z'))).toBe('RETURNED');
  });

  it('is OVERDUE one second after dueAt', () => {
    const loan: Pick<Loan, 'dueAt' | 'returnedAt'> = { dueAt, returnedAt: null };
    expect(loanState(loan, new Date(dueAt.getTime() + 1_000))).toBe('OVERDUE');
  });

  it('is not yet OVERDUE at exactly dueAt', () => {
    const loan: Pick<Loan, 'dueAt' | 'returnedAt'> = { dueAt, returnedAt: null };
    expect(loanState(loan, dueAt)).not.toBe('OVERDUE');
  });

  it('is DUE_SOON inside the due-soon window', () => {
    const loan: Pick<Loan, 'dueAt' | 'returnedAt'> = { dueAt, returnedAt: null };
    const now = new Date(dueAt.getTime() - (DUE_SOON_WINDOW_DAYS * MS_PER_DAY - 1));
    expect(loanState(loan, now)).toBe('DUE_SOON');
  });

  it('is ACTIVE just outside the due-soon window', () => {
    const loan: Pick<Loan, 'dueAt' | 'returnedAt'> = { dueAt, returnedAt: null };
    const now = new Date(dueAt.getTime() - (DUE_SOON_WINDOW_DAYS * MS_PER_DAY + 1));
    expect(loanState(loan, now)).toBe('ACTIVE');
  });
});

describe('nextHoldToPromote', () => {
  const notExpired = new Date(NOW.getTime() + MS_PER_DAY);
  const expired = new Date(NOW.getTime() - 1);

  it('returns null for an empty hold list', () => {
    expect(nextHoldToPromote([], NOW)).toBeNull();
  });

  it('returns null when every hold has expired', () => {
    const holds: Hold[] = [
      { memberId: 'm1', queuePosition: 1, expiresAt: expired },
      { memberId: 'm2', queuePosition: 2, expiresAt: expired },
    ];
    expect(nextHoldToPromote(holds, NOW)).toBeNull();
  });

  it('skips an expired hold and returns the lowest queue position among the rest', () => {
    const holds: Hold[] = [
      { memberId: 'earliest-but-expired', queuePosition: 1, expiresAt: expired },
      { memberId: 'next-in-line', queuePosition: 2, expiresAt: notExpired },
      { memberId: 'later', queuePosition: 3, expiresAt: notExpired },
    ];
    expect(nextHoldToPromote(holds, NOW)).toEqual({ memberId: 'next-in-line', queuePosition: 2, expiresAt: notExpired });
  });

  it('a hold expiring at exactly now is treated as expired', () => {
    const holds: Hold[] = [{ memberId: 'm1', queuePosition: 1, expiresAt: NOW }];
    expect(nextHoldToPromote(holds, NOW)).toBeNull();
  });
});

describe('holdShelfExpiry', () => {
  it('is exactly policy.holdShelfDays after now', () => {
    expect(holdShelfExpiry(POLICY, NOW)).toEqual(new Date(NOW.getTime() + POLICY.holdShelfDays * MS_PER_DAY));
  });

  it('zero holdShelfDays returns now unchanged', () => {
    expect(holdShelfExpiry({ ...POLICY, holdShelfDays: 0 }, NOW)).toEqual(NOW);
  });
});

describe('holdState', () => {
  const notExpired = new Date(NOW.getTime() + MS_PER_DAY);
  const expired = new Date(NOW.getTime() - 1);

  it('a READY hold not yet past its shelf deadline stays READY', () => {
    expect(holdState({ status: 'READY', expiresAt: notExpired }, NOW)).toBe('READY');
  });

  it('a READY hold past its shelf deadline reads as EXPIRED, even though nothing wrote that', () => {
    expect(holdState({ status: 'READY', expiresAt: expired }, NOW)).toBe('EXPIRED');
  });

  it('a READY hold expiring at exactly now reads as EXPIRED (same boundary as nextHoldToPromote)', () => {
    expect(holdState({ status: 'READY', expiresAt: NOW }, NOW)).toBe('EXPIRED');
  });

  it('a PENDING hold is never reinterpreted by expiresAt, however far in the past', () => {
    expect(holdState({ status: 'PENDING', expiresAt: expired }, NOW)).toBe('PENDING');
  });

  const terminal: HoldStatusValue[] = ['COLLECTED', 'EXPIRED', 'CANCELLED'];
  for (const status of terminal) {
    it(`a terminal ${status} hold passes through unchanged regardless of expiresAt`, () => {
      expect(holdState({ status, expiresAt: expired }, NOW)).toBe(status);
    });
  }
});
