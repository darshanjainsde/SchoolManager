const txMock = {
  pressIssue: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  student: { findFirst: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { PressRegisterService } from './press-register.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ISSUE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

describe('PressRegisterService.void', () => {
  const svc = new PressRegisterService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
  });

  it('strikes an entry through: voidedAt + who + why, nothing else', async () => {
    txMock.pressIssue.findFirst.mockResolvedValue({ id: ISSUE, voidedAt: null });
    txMock.pressIssue.update.mockResolvedValue({});

    await svc.void(SCHOOL, ISSUE, '  wrong marks — reissued after correction  ', USER);

    const call = txMock.pressIssue.update.mock.calls[0]![0];
    expect(call.where).toEqual({ id: ISSUE });
    expect(call.data.voidNote).toBe('wrong marks — reissued after correction');
    expect(call.data.voidedById).toBe(USER);
    expect(call.data.voidedAt).toBeInstanceOf(Date);
    // The database trigger enforces that ONLY these three columns may change;
    // the service must not even try to touch anything else.
    expect(Object.keys(call.data).sort()).toEqual(['voidNote', 'voidedAt', 'voidedById']);
  });

  it('404s an entry the tenant cannot see', async () => {
    txMock.pressIssue.findFirst.mockResolvedValue(null);
    await expect(svc.void(SCHOOL, ISSUE, 'note', USER)).rejects.toMatchObject({ status: 404 });
    expect(txMock.pressIssue.update).not.toHaveBeenCalled();
  });

  it('refuses to void twice — a struck-through entry stays exactly as struck', async () => {
    txMock.pressIssue.findFirst.mockResolvedValue({ id: ISSUE, voidedAt: new Date() });
    await expect(svc.void(SCHOOL, ISSUE, 'note', USER)).rejects.toMatchObject({
      status: 409,
      response: { code: 'ALREADY_VOIDED' },
    });
    expect(txMock.pressIssue.update).not.toHaveBeenCalled();
  });
});

describe('PressRegisterService — the family reads', () => {
  const svc = new PressRegisterService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
  });

  it('hides voided cards from the portal — the family sees the corrected one, not the mistake', async () => {
    txMock.student.findFirst.mockResolvedValue({ id: 'stu-1' });
    txMock.pressIssue.findMany.mockResolvedValue([]);

    await svc.myReportCards(SCHOOL, USER);

    expect(txMock.pressIssue.findMany.mock.calls[0]![0].where).toMatchObject({ voidedAt: null });
  });

  it('answers an empty list, not an error, for a login with no student row', async () => {
    txMock.student.findFirst.mockResolvedValue(null);
    await expect(svc.myReportCards(SCHOOL, USER)).resolves.toEqual([]);
  });
});
