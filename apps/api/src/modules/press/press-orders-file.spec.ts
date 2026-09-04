import 'reflect-metadata';

const txMock = { printOrder: { findFirst: jest.fn() } };
const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  getPlatformPrisma: () => ({}),
}));

import { PressOrdersService } from './press-orders.service';
import { ApiError } from '../../common/errors/api-error';

/**
 * THE SCHOOL COULD NOT SEE WHAT IT HAD SENT.
 *
 * An upload produced a row naming a file, and the school was then asked to
 * approve a paid print run on trust — with no way to check the right document
 * was attached. This is the missing half of that loop, and the rules around it
 * are what keep it from becoming a way to leak storage keys.
 */

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const storage = { presignedGet: jest.fn().mockResolvedValue('https://signed.example/doc.pdf?sig=x') };
const service = () => new PressOrdersService(storage as never);

beforeEach(() => {
  jest.clearAllMocks();
  storage.presignedGet.mockResolvedValue('https://signed.example/doc.pdf?sig=x');
});

describe('opening your own uploaded document', () => {
  it('hands back a short-lived link and the filename', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({
      kind: 'UPLOAD',
      source: { kind: 'UPLOAD', fileKey: 'print-orders/x/y-Term1.pdf', filename: 'Term1.pdf' },
    });

    const out = await service().fileUrl(SCHOOL, ORDER);

    expect(out).toEqual({
      filename: 'Term1.pdf',
      url: 'https://signed.example/doc.pdf?sig=x',
      expiresInSeconds: 300,
    });
  });

  /** The storage key is what `detail()` strips on purpose; minting a link must
   *  not quietly put it back on the wire. */
  it('never returns the storage key itself', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({
      kind: 'UPLOAD',
      source: { kind: 'UPLOAD', fileKey: 'print-orders/secret/path.pdf', filename: 'Term1.pdf' },
    });

    const out = await service().fileUrl(SCHOOL, ORDER);

    expect(JSON.stringify(out)).not.toContain('print-orders/secret/path.pdf');
  });

  it('signs for five minutes — long enough to open, short enough that a copied link dies', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({
      kind: 'UPLOAD',
      source: { kind: 'UPLOAD', fileKey: 'k', filename: 'f.pdf' },
    });

    await service().fileUrl(SCHOOL, ORDER);

    expect(storage.presignedGet).toHaveBeenCalledWith('k', 300);
  });

  /**
   * Unlike the operator's `artifact`, this is NOT gated on status. The operator
   * may not peek before the school commits; the school is looking at its own
   * document, and the moment it most needs to look is BEFORE confirming. A gate
   * here would remove the only check that matters.
   */
  it.each(['REQUESTED', 'QUOTED', 'CONFIRMED', 'PRINTING', 'DELIVERED'])(
    'opens at status %s, because checking matters most before confirming',
    async (status) => {
      txMock.printOrder.findFirst.mockResolvedValue({
        kind: 'UPLOAD', status,
        source: { kind: 'UPLOAD', fileKey: 'k', filename: 'f.pdf' },
      });

      await expect(service().fileUrl(SCHOOL, ORDER)).resolves.toHaveProperty('url');
    },
  );
});

describe('when there is nothing to open', () => {
  it('says so for a report-card order, and points at where the sheets live', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({ kind: 'REPORT_CARDS', source: { kind: 'REPORT_CARDS' } });

    // ApiError extends Nest's HttpException, so the code lives in the response
    // body rather than on the instance.
    const err = await service().fileUrl(SCHOOL, ORDER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).getStatus()).toBe(409);
    expect((err as ApiError).getResponse()).toMatchObject({ code: 'ORDER_HAS_NO_FILE' });
    expect(storage.presignedGet).not.toHaveBeenCalled();
  });

  it('404s an upload row whose key is missing rather than signing an empty one', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({ kind: 'UPLOAD', source: { kind: 'UPLOAD', filename: 'f.pdf' } });

    await expect(service().fileUrl(SCHOOL, ORDER)).rejects.toBeInstanceOf(ApiError);
    expect(storage.presignedGet).not.toHaveBeenCalled();
  });

  /** Another school's order is NOT FOUND, never forbidden — the difference
   *  between the two answers tells a caller the order exists. */
  it('does not find an order belonging to another school', async () => {
    txMock.printOrder.findFirst.mockResolvedValue(null);

    const err = await service().fileUrl(SCHOOL, ORDER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).getStatus()).toBe(404);
    expect(storage.presignedGet).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the caller’s school', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({ kind: 'UPLOAD', source: { kind: 'UPLOAD', fileKey: 'k', filename: 'f' } });

    await service().fileUrl(SCHOOL, ORDER);

    expect(withTenantMock).toHaveBeenCalledWith(SCHOOL, expect.any(Function));
  });
});
