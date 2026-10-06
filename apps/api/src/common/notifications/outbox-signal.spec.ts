import { OUTBOX_DRAIN_DELAY_MS, registerOutboxDrainer, requestOutboxDrain, resetOutboxSignal } from './outbox-signal';

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
