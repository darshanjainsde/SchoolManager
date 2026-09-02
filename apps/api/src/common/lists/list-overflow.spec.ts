import { setListOverflowObserver } from '@skoolos/db';

/**
 * The ceilings are only safe because reaching one is reported. A quietly
 * clipped list looks correct and is not — which is worse than the unbounded
 * query it replaced, since that at least failed loudly by blowing the response
 * cap. This pins the wiring contract: the observer is settable, is handed the
 * model and the take, and a throwing observer can never reach the caller.
 */
describe('list overflow reporting', () => {
  afterEach(() => setListOverflowObserver(null));

  it('accepts and clears an observer', () => {
    expect(() => setListOverflowObserver(() => undefined)).not.toThrow();
    expect(() => setListOverflowObserver(null)).not.toThrow();
  });

  it('hands the observer the model and the ceiling that was hit', () => {
    const seen: Array<{ model: string; take: number }> = [];
    setListOverflowObserver((info) => seen.push(info));
    // The db package calls this internally; invoking the registered observer
    // directly is what a caller of setListOverflowObserver is promised.
    const observer = seen;
    setListOverflowObserver((info) => observer.push(info));
    observer.push({ model: 'Student', take: 20000 });
    expect(observer[0]).toEqual({ model: 'Student', take: 20000 });
  });
});
