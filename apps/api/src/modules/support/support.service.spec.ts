import type { ApiError } from '../../common/errors/api-error';

/**
 * The race guards, proven deterministically.
 *
 * Every status write in SupportService is an \`updateMany\` guarded on the
 * status it expects. Under READ COMMITTED a read-then-update lets two people
 * both win (confirm + reopen, owner move + sweep), which could leave a CLOSED
 * ticket with no resolution date that nobody can ever move again. The e2e
 * races cannot prove this: the test pool serialises the requests before they
 * reach the guard. So each test here stages the losing interleaving directly —
 * the read sees the old status, the guarded write finds it already moved — and
 * asserts the loser gets a 409 and writes NO timeline line.
 */
const tx = {
  supportTicket: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  supportTicketEntry: { create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  user: { findFirst: jest.fn() },
  school: { findFirst: jest.fn() },
  notification: { create: jest.fn() },
  notificationOutbox: { create: jest.fn() },
  $transaction: jest.fn(),
};
tx.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: async (_s: string, fn: (t: unknown) => unknown) => fn(tx),
  getPlatformPrisma: () => tx,
}));

import { SupportService } from './support.service';

const code = (e: unknown) => ((e as ApiError).getResponse() as { code: string }).code;
/** Resolves to the error the promise rejected with; fails the test if it resolved. */
async function failure(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  throw new Error('expected a rejection');
}
const svc = () =>
  new SupportService(
    { upload: jest.fn(), delete: jest.fn(), presignedGet: jest.fn() } as never,
    { sendLetter: jest.fn() } as never,
    { getConfigRow: jest.fn(async () => ({ contactEmail: '' })) } as never,
    { mint: jest.fn() } as never,
  );
const V = { schoolId: 's1', userId: 'u1' };

beforeEach(() => {
  jest.clearAllMocks();
  tx.user.findFirst.mockResolvedValue({ name: 'Priya', email: 'p@x.test' });
  tx.supportTicket.updateMany.mockResolvedValue({ count: 0 }); // somebody else moved it first
});

it('confirm: the second of two confirms gets 409 and writes no line', async () => {
  tx.supportTicket.findFirst.mockResolvedValue({ status: 'RESOLVED' });
  { const err = await failure(svc().confirm(V, 't1')); expect(code(err) === 'SUPPORT_ILLEGAL_MOVE').toBe(true); }
  expect(tx.supportTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'RESOLVED' }) }));
  expect(tx.supportTicketEntry.create).not.toHaveBeenCalled();
});

it('reopen: a reopen that lost to a move gets 409 and writes no line', async () => {
  tx.supportTicket.findFirst.mockResolvedValue({ status: 'RESOLVED', resolvedAt: new Date() });
  { const err = await failure(svc().reopen(V, 't1', 'still broken')); expect(code(err) === 'SUPPORT_ILLEGAL_MOVE').toBe(true); }
  expect(tx.supportTicketEntry.create).not.toHaveBeenCalled();
});

it('owner move: a move from a status the ticket has already left gets 409 and writes no line', async () => {
  tx.supportTicket.findUnique.mockResolvedValue({ schoolId: 's1', status: 'IN_PROGRESS', acknowledgedAt: null });
  { const err = await failure(svc().ownerStatus({ userId: 'o1' }, 't1', 'RESOLVED')); expect(code(err) === 'SUPPORT_ILLEGAL_MOVE').toBe(true); }
  expect(tx.supportTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 't1', schoolId: 's1', status: 'IN_PROGRESS' }) }));
  expect(tx.supportTicketEntry.create).not.toHaveBeenCalled();
});

it('school reply: resolved meanwhile → 409 pointing at reopen, and no line is written', async () => {
  tx.supportTicket.findFirst
    .mockResolvedValueOnce({ id: 't1', status: 'WAITING_ON_SCHOOL' }) // the read before the upload
    .mockResolvedValueOnce({ status: 'RESOLVED' }); // the re-read after both guarded writes missed
  const s = svc();
  { const err = await failure(s.schoolComment(V, 't1', 'done', [])); expect(/reopen/i.test((err as Error).message)).toBe(true); }
  expect(tx.supportTicketEntry.create).not.toHaveBeenCalled();
});

it('sweep: a ticket the owner pulled back (or another sweep closed) is skipped with no line', async () => {
  tx.supportTicket.findMany.mockResolvedValue([{ id: 't1', schoolId: 's1', resolvedAt: new Date(Date.now() - 9 * 86_400_000) }]);
  await svc().sweep(tx as never, null);
  expect(tx.supportTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'RESOLVED' }) }));
  expect(tx.supportTicketEntry.create).not.toHaveBeenCalled();
});

it('sweep: the winner closes it, ends look-in, and writes exactly one line', async () => {
  tx.supportTicket.findMany.mockResolvedValue([{ id: 't1', schoolId: 's1', resolvedAt: new Date(Date.now() - 9 * 86_400_000) }]);
  tx.supportTicket.updateMany.mockResolvedValue({ count: 1 });
  await svc().sweep(tx as never, null);
  expect(tx.supportTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', lookInUntil: null }) }));
  expect(tx.supportTicketEntry.create).toHaveBeenCalledTimes(1);
});
