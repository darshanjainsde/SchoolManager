import { resetWaitUntilCache, runInBackground } from './run-in-background';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('runInBackground', () => {
  const ORIGINAL_VERCEL = process.env.VERCEL;

  beforeEach(() => {
    resetWaitUntilCache();
  });

  afterEach(() => {
    if (ORIGINAL_VERCEL === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = ORIGINAL_VERCEL;
    }
    resetWaitUntilCache();
  });

  it('runs the work without the caller having to await it', async () => {
    const work = jest.fn().mockResolvedValue(undefined);
    const onError = jest.fn();

    runInBackground(work, onError);
    await flush();

    expect(work).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes a rejection to onError instead of leaving an unhandled rejection', async () => {
    const boom = new Error('smtp down');
    const onError = jest.fn();

    runInBackground(() => Promise.reject(boom), onError);
    await flush();

    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('routes a synchronous throw to onError too', () => {
    const boom = new Error('built the payload wrong');
    const onError = jest.fn();

    runInBackground(() => {
      throw boom;
    }, onError);

    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('does not reach for @vercel/functions off Vercel (local dev / tests)', async () => {
    delete process.env.VERCEL;
    const onError = jest.fn();

    // No throw, work still runs: the fallback path is a plain floating promise.
    runInBackground(async () => undefined, onError);
    await flush();

    expect(onError).not.toHaveBeenCalled();
  });
});
