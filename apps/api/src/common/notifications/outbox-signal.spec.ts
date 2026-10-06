import { INVOCATION_CEILING_MS, OUTBOX_DRAIN_DELAY_MS, ROW_START_RESERVE_MS, registerOutboxDrainer, requestOutboxDrain, resetOutboxSignal } from './outbox-signal';
import { invocationStartedAt, runInvocation } from './invocation-clock';

describe('requestOutboxDrain', () => {
  beforeEach(() => { jest.useFakeTimers(); resetOutboxSignal(); });
  afterEach(() => { jest.useRealTimers(); resetOutboxSignal(); });

  it('does nothing when no drainer is registered (a script, a unit test)', async () => {
    expect(() => requestOutboxDrain()).not.toThrow();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS * 2);
  });

  it('waits for the caller to commit, then drains once for a burst of requests', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    requestOutboxDrain(); requestOutboxDrain(); requestOutboxDrain();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS - 1);
    expect(drain).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('a request that arrives while a drain runs schedules the next one', async () => {
    let finish!: () => void;
    const drain = jest.fn().mockImplementationOnce(() => new Promise<void>((r) => { finish = r; })).mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    requestOutboxDrain();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    requestOutboxDrain(); // the first drain is still running
    finish();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it('a failed drain is swallowed and does not block the next request', async () => {
    const drain = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    requestOutboxDrain();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    requestOutboxDrain();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledTimes(2);
  });
});

describe('the drain knows the invocation it runs in', () => {
  beforeEach(() => { jest.useFakeTimers(); resetOutboxSignal(); });
  afterEach(() => { jest.useRealTimers(); resetOutboxSignal(); });

  it('a drain asked for 30 s into a request must stop starting sends 30 s sooner', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    const requestStarted = Date.now() - 30_000;
    runInvocation(() => requestOutboxDrain(), requestStarted);
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledWith({ deadline: requestStarted + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS });
  });

  it('outside any request (a script) the drain keeps its own budget', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    requestOutboxDrain();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledWith({ deadline: undefined });
  });

  it('a burst keeps the LATEST deadline — a request ~45 s old must not starve a fresh one\'s drain', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    const old = Date.now() - 45_000;
    const fresh = Date.now();
    runInvocation(() => requestOutboxDrain(), old);
    runInvocation(() => requestOutboxDrain(), fresh);
    runInvocation(() => requestOutboxDrain(), old);
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith({ deadline: fresh + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS });
  });

  it('the drain runs inside the invocation with the most time left', async () => {
    const seen: Array<number | undefined> = [];
    registerOutboxDrainer(async () => { seen.push(invocationStartedAt()); });
    const old = Date.now() - 45_000;
    const fresh = Date.now();
    runInvocation(() => requestOutboxDrain(), old);
    runInvocation(() => requestOutboxDrain(), fresh);
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(seen).toEqual([fresh]);
  });

  it('a later request never pushes the burst\'s drain back', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    const t0 = Date.now();
    runInvocation(() => requestOutboxDrain(), t0 - 40_000);
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS - 100);
    runInvocation(() => requestOutboxDrain(), Date.now());
    await jest.advanceTimersByTimeAsync(100);
    expect(drain).toHaveBeenCalledTimes(1);
  });
});
