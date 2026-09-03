const txMock = {
  reportWindow: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  pressIssue: { findMany: jest.fn() },
  printOrder: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  school: { findFirst: jest.fn() },
  schoolProfile: { findFirst: jest.fn() },
  user: { findFirst: jest.fn() },
};
const platformMock = {
  printOrder: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  pressIssue: { findMany: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
  getPlatformPrisma: () => platformMock,
}));

import { OperatorOrdersService } from './operator-orders.service';
import { assertTransition, PressOrdersService } from './press-orders.service';
import type { StorageService } from '../../common/storage/storage.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WINDOW = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SECTION = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const storage = {
  upload: jest.fn(),
  delete: jest.fn(),
  presignedGet: jest.fn(),
  publicUrl: jest.fn(),
} as unknown as StorageService & { upload: jest.Mock; delete: jest.Mock; presignedGet: jest.Mock };

const SPEC = { size: 'A4', colour: 'COLOUR', sides: 'DOUBLE', gsm: 130, finish: 'STAPLE' } as const;

/** A full DB record, the shape detail()/toRow read. */
function orderRecord(over: Record<string, unknown> = {}) {
  return {
    id: ORDER, schoolId: SCHOOL, kind: 'REPORT_CARDS',
    title: 'Report cards · Term I · VII-B', quantity: 42, spec: SPEC,
    source: {
      kind: 'REPORT_CARDS', windowId: WINDOW, classSectionId: SECTION,
      windowName: 'Term I', classLabel: 'VII-B', issuedCount: 42,
      serialFrom: 'REP/2026/0001', serialTo: 'REP/2026/0042',
    },
    deliverTo: { schoolName: 'Raffles', address: 'MG Road, Jaipur', contactName: 'admin', phone: '98' },
    neededBy: null, note: null, status: 'REQUESTED',
    quotePriceMinor: null, promisedBy: null, quoteNote: null, quotedAt: null, confirmedAt: null,
    createdAt: new Date('2026-09-03T05:00:00Z'), updatedAt: new Date(),
    events: [],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
  txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
  txMock.schoolProfile.findFirst.mockResolvedValue({ addressLine1: 'MG Road', city: 'Jaipur', region: 'RJ', phone: '98' });
  txMock.user.findFirst.mockResolvedValue({ username: 'admin', email: 'admin@raffles.test' });
});

describe('the transition map', () => {
  it('is the whole contract: who may move an order where', () => {
    // The school's two moves
    expect(() => assertTransition('SCHOOL', 'QUOTED', 'CONFIRMED')).not.toThrow();
    expect(() => assertTransition('SCHOOL', 'REQUESTED', 'CANCELLED')).not.toThrow();
    // Confirming an unquoted order — there is no price to accept
    expect(() => assertTransition('SCHOOL', 'REQUESTED', 'CONFIRMED')).toThrow();
    // Cancelling after confirmation is a phone call, not a button
    expect(() => assertTransition('SCHOOL', 'CONFIRMED', 'CANCELLED')).toThrow();
    // The operator may re-quote until confirmation, never after — the
    // accepted quote is the contract
    expect(() => assertTransition('SCKOOLS', 'QUOTED', 'QUOTED')).not.toThrow();
    expect(() => assertTransition('SCKOOLS', 'CONFIRMED', 'QUOTED')).toThrow();
    // Printing starts only on a confirmed order
    expect(() => assertTransition('SCKOOLS', 'QUOTED', 'PRINTING')).toThrow();
    // Hand-delivery may skip DISPATCHED; delivering an unprinted order cannot
    expect(() => assertTransition('SCKOOLS', 'PRINTING', 'DELIVERED')).not.toThrow();
    expect(() => assertTransition('SCKOOLS', 'CONFIRMED', 'DELIVERED')).toThrow();
    // Terminal states stay terminal
    for (const from of ['DELIVERED', 'DECLINED', 'CANCELLED'] as const) {
      for (const to of ['QUOTED', 'PRINTING', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const) {
        expect(() => assertTransition('SCHOOL', from, to)).toThrow();
        expect(() => assertTransition('SCKOOLS', from, to)).toThrow();
      }
    }
  });
});

describe('PressOrdersService — requesting', () => {
  const svc = new PressOrdersService(storage);
  const dto = { windowId: WINDOW, classSectionId: SECTION, quantity: 42, ...SPEC };

  it('refuses a report-card order for a batch with nothing issued — we print the register, not a preview', async () => {
    txMock.reportWindow.findFirst.mockResolvedValue({ name: 'Term I' });
    txMock.classSection.findFirst.mockResolvedValue({ name: 'B', grade: { name: 'VII' } });
    txMock.pressIssue.findMany.mockResolvedValue([]);

    await expect(svc.createForReportCards(SCHOOL, dto as never, USER)).rejects.toMatchObject({
      status: 409, response: { code: 'ISSUED_BATCH_REQUIRED' },
    });
    expect(txMock.printOrder.create).not.toHaveBeenCalled();
  });

  it('freezes the batch facts at request time and logs REQUESTED in the same breath', async () => {
    txMock.reportWindow.findFirst.mockResolvedValue({ name: 'Term I' });
    txMock.classSection.findFirst.mockResolvedValue({ name: 'B', grade: { name: 'VII' } });
    txMock.pressIssue.findMany.mockResolvedValue([
      { serial: 'REP/2026/0001' }, { serial: 'REP/2026/0042' },
    ]);
    txMock.printOrder.create.mockResolvedValue({ id: ORDER });
    txMock.printOrder.findFirst.mockResolvedValue(orderRecord());

    await svc.createForReportCards(SCHOOL, dto as never, USER);

    const data = txMock.printOrder.create.mock.calls[0]![0].data;
    expect(data.source).toMatchObject({
      issuedCount: 2, serialFrom: 'REP/2026/0001', serialTo: 'REP/2026/0042',
      windowName: 'Term I', classLabel: 'VII-B',
    });
    // Only issued, non-void cards of THIS class count
    expect(txMock.pressIssue.findMany.mock.calls[0]![0].where).toMatchObject({
      type: 'REPORT_CARD', windowId: WINDOW, voidedAt: null,
      student: { classSectionId: SECTION },
    });
    expect(data.deliverTo).toMatchObject({ schoolName: 'Raffles', address: 'MG Road, Jaipur, RJ' });
    expect(data.events.create).toMatchObject({ actor: 'SCHOOL', action: 'REQUESTED' });
  });

  it('takes only PDFs — a .docx is a validation message, not a broken print', async () => {
    await expect(svc.createForUpload(SCHOOL, { title: 'Paper' } as never,
      { originalname: 'paper.docx', buffer: Buffer.from('x'), mimetype: 'application/msword' }, USER,
    )).rejects.toMatchObject({ status: 400, response: { code: 'VALIDATION' } });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('deletes the uploaded file if the order row fails — nothing confidential lingers unreferenced', async () => {
    storage.upload.mockResolvedValue({ key: 'print-orders/x/y.pdf', url: 'u' });
    txMock.printOrder.create.mockRejectedValue(new Error('boom'));

    await expect(svc.createForUpload(SCHOOL,
      { title: 'Term I Maths paper', quantity: 400, ...SPEC } as never,
      { originalname: 'paper.pdf', buffer: Buffer.from('pdf'), mimetype: 'application/pdf' }, USER,
    )).rejects.toThrow('boom');
    expect(storage.delete).toHaveBeenCalledWith('print-orders/x/y.pdf');
  });

  it("the school's own view never carries the storage key", async () => {
    txMock.printOrder.findFirst.mockResolvedValue(orderRecord({
      kind: 'UPLOAD',
      source: { kind: 'UPLOAD', fileKey: 'print-orders/secret.pdf', filename: 'paper.pdf', bytes: 9, contentType: 'application/pdf' },
    }));
    const detail = await svc.one(SCHOOL, ORDER);
    expect(detail.source).toEqual({ kind: 'UPLOAD', filename: 'paper.pdf', bytes: 9 });
    expect(JSON.stringify(detail)).not.toContain('fileKey');
  });
});

describe('PressOrdersService — confirming and cancelling', () => {
  const svc = new PressOrdersService(storage);

  it('confirm freezes the accepted quote into the event log', async () => {
    txMock.printOrder.findFirst
      .mockResolvedValueOnce({ status: 'QUOTED', quotePriceMinor: 120000, promisedBy: new Date('2026-09-10') })
      .mockResolvedValueOnce(orderRecord({ status: 'CONFIRMED' }));
    txMock.printOrder.update.mockResolvedValue({});

    await svc.confirm(SCHOOL, ORDER, USER);

    const call = txMock.printOrder.update.mock.calls[0]![0];
    expect(call.data.status).toBe('CONFIRMED');
    expect(call.data.confirmedAt).toBeInstanceOf(Date);
    expect(call.data.events.create).toMatchObject({
      actor: 'SCHOOL', action: 'CONFIRMED',
      data: { priceMinor: 120000 },
    });
  });

  it('confirming an unquoted order is a 409, not a silent acceptance of nothing', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({ status: 'REQUESTED', quotePriceMinor: null, promisedBy: null });
    await expect(svc.confirm(SCHOOL, ORDER, USER)).rejects.toMatchObject({
      status: 409, response: { code: 'ORDER_TRANSITION_ILLEGAL' },
    });
    expect(txMock.printOrder.update).not.toHaveBeenCalled();
  });

  it('cancelling after confirmation is refused — the paper may already be on the press', async () => {
    txMock.printOrder.findFirst.mockResolvedValue({ status: 'CONFIRMED' });
    await expect(svc.cancel(SCHOOL, ORDER, {}, USER)).rejects.toMatchObject({
      status: 409, response: { code: 'ORDER_TRANSITION_ILLEGAL' },
    });
  });
});

describe('OperatorOrdersService — the desk', () => {
  const svc = new OperatorOrdersService(storage);

  it('quote logs the promise: price + promisedBy land on the row AND in the event', async () => {
    platformMock.printOrder.findUnique.mockResolvedValue({ schoolId: SCHOOL, status: 'REQUESTED' });
    platformMock.printOrder.update.mockResolvedValue({});

    await svc.quote(ORDER, { priceMinor: 240000, promisedBy: '2026-09-10', note: '  incl. delivery ' } as never);

    const call = platformMock.printOrder.update.mock.calls[0]![0];
    expect(call.data).toMatchObject({ status: 'QUOTED', quotePriceMinor: 240000, quoteNote: 'incl. delivery' });
    expect(call.data.quotedAt).toBeInstanceOf(Date);
    expect(call.data.events.create).toMatchObject({
      actor: 'SCKOOLS', action: 'QUOTED', data: { priceMinor: 240000, promisedBy: '2026-09-10' },
    });
  });

  it('a confirmed order cannot be re-quoted — the accepted price is the contract', async () => {
    platformMock.printOrder.findUnique.mockResolvedValue({ schoolId: SCHOOL, status: 'CONFIRMED' });
    await expect(svc.quote(ORDER, { priceMinor: 999999, promisedBy: '2026-09-10' } as never))
      .rejects.toMatchObject({ status: 409, response: { code: 'ORDER_TRANSITION_ILLEGAL' } });
    expect(platformMock.printOrder.update).not.toHaveBeenCalled();
  });

  it('dispatch records the courier and ref in the event — the school reads them on the timeline', async () => {
    platformMock.printOrder.findUnique.mockResolvedValue({ schoolId: SCHOOL, status: 'PRINTING' });
    platformMock.printOrder.update.mockResolvedValue({});

    await svc.dispatch(ORDER, { courier: ' DTDC ', ref: 'D123 ' } as never);

    expect(platformMock.printOrder.update.mock.calls[0]![0].data.events.create).toMatchObject({
      action: 'DISPATCHED', data: { courier: 'DTDC', ref: 'D123' },
    });
  });

  it('printing an order the school has not confirmed is refused', async () => {
    platformMock.printOrder.findUnique.mockResolvedValue({ schoolId: SCHOOL, status: 'QUOTED' });
    await expect(svc.markPrinting(ORDER)).rejects.toMatchObject({
      status: 409, response: { code: 'ORDER_TRANSITION_ILLEGAL' },
    });
  });

  it('the artifact stays shut until the school confirms — no peeking at a quoted upload', async () => {
    platformMock.printOrder.findUnique.mockResolvedValue({
      kind: 'UPLOAD', schoolId: SCHOOL, status: 'QUOTED',
      source: { kind: 'UPLOAD', fileKey: 'k', filename: 'paper.pdf' },
    });
    await expect(svc.artifact(ORDER)).rejects.toMatchObject({ status: 409 });
    expect(storage.presignedGet).not.toHaveBeenCalled();
  });

  it('an upload artifact is a short-lived private link, never a public URL', async () => {
    platformMock.printOrder.findUnique.mockResolvedValue({
      kind: 'UPLOAD', schoolId: SCHOOL, status: 'CONFIRMED',
      source: { kind: 'UPLOAD', fileKey: 'print-orders/s/paper.pdf', filename: 'paper.pdf' },
    });
    storage.presignedGet.mockResolvedValue('https://signed.example/paper?sig=x');

    const a = await svc.artifact(ORDER);

    expect(storage.presignedGet).toHaveBeenCalledWith('print-orders/s/paper.pdf', 900);
    expect(a).toEqual({ kind: 'UPLOAD', filename: 'paper.pdf', url: 'https://signed.example/paper?sig=x', expiresInSeconds: 900 });
  });

  it('a report-card artifact is the frozen register — issued snapshots, voided cards excluded, never recompiled', async () => {
    platformMock.printOrder.findUnique.mockResolvedValue({
      kind: 'REPORT_CARDS', schoolId: SCHOOL, status: 'PRINTING',
      source: { kind: 'REPORT_CARDS', windowId: WINDOW, classSectionId: SECTION },
    });
    platformMock.pressIssue.findMany.mockResolvedValue([
      { serial: 'REP/2026/0001', payload: { kind: 'REPORT_CARD', windowName: 'Term I' } },
    ]);

    const a = await svc.artifact(ORDER);

    expect(platformMock.pressIssue.findMany.mock.calls[0]![0].where).toMatchObject({
      schoolId: SCHOOL, type: 'REPORT_CARD', windowId: WINDOW, voidedAt: null,
      student: { classSectionId: SECTION },
    });
    expect(a).toMatchObject({ kind: 'REPORT_CARDS', sheets: [{ serial: 'REP/2026/0001' }] });
  });

  it('lateness is measured against the logged promise, and only while the order is still open', async () => {
    const promised = new Date('2026-08-30T00:00:00Z');
    platformMock.printOrder.findMany.mockResolvedValue([
      orderRecord({ status: 'PRINTING', promisedBy: promised, quotePriceMinor: 1, quotedAt: new Date(), school: { name: 'R', slug: 'r', profile: { city: 'Jaipur' } } }),
      orderRecord({ status: 'DELIVERED', promisedBy: promised, quotePriceMinor: 1, quotedAt: new Date(), school: { name: 'R', slug: 'r', profile: null } }),
    ]);

    const rows = await svc.listAll();

    expect(rows[0]!.daysLate).toBeGreaterThanOrEqual(3); // promised 30 Aug, today ≥ 2 Sep IST
    expect(rows[1]!.daysLate).toBeNull(); // delivered is done — nothing is late any more
  });
});
