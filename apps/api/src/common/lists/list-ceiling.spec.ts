import { LIST_CEILING } from './list-ceiling';

/**
 * These numbers are a safety net, and a safety net that can be reached in
 * normal use is a bug generator rather than a guard. The tests pin the
 * properties the ceilings are chosen for, so a later "let's tidy these up"
 * has to argue with the reasoning rather than just change a number.
 */
describe('LIST_CEILING', () => {
  // 227 KB per 500 rows, measured on the seeded database. The platform cap is
  // 4.5 MB, so a ceiling is only safe if ceiling x per-row stays well under it.
  const BYTES_PER_ROW = (227 * 1024) / 500;
  const PLATFORM_CAP = 4.5 * 1024 * 1024;

  it('keeps a structural list far below the response cap', () => {
    expect(LIST_CEILING.STRUCTURE * BYTES_PER_ROW).toBeLessThan(PLATFORM_CAP);
  });

  it('keeps an activity list far below the response cap', () => {
    expect(LIST_CEILING.ACTIVITY * BYTES_PER_ROW).toBeLessThan(PLATFORM_CAP);
  });

  it('sets the roster ceiling above any real school, so it cannot truncate a roll', () => {
    // The largest schools in India run to a few thousand; alumni accumulate for
    // decades. A ceiling that a real school could hit would silently drop people.
    expect(LIST_CEILING.ROSTER).toBeGreaterThan(10_000);
  });

  it('orders the ceilings by how fast each class actually grows', () => {
    expect(LIST_CEILING.STRUCTURE).toBeLessThan(LIST_CEILING.ACTIVITY);
    expect(LIST_CEILING.ACTIVITY).toBeLessThan(LIST_CEILING.ROSTER);
  });
});
