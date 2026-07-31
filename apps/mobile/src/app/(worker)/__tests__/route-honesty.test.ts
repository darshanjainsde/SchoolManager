import * as fs from 'fs';
import * as path from 'path';

/**
 * Cut-down version of (staff)'s route-honesty.test.ts: (worker) has no
 * nav-data module of its own (VISIBLE_TABS/HIDDEN_ROUTES/MORE_ITEMS) since
 * there is exactly one tab — extracting a whole data-driven module for a
 * single hardcoded `<Tabs.Screen name="today" />` would be over-engineering
 * for a "currently minimal" portal. This just proves that one screen file
 * actually exists, so a rename here fails loudly instead of shipping a dead
 * tab.
 */
const WORKER_DIR = path.join(__dirname, '..'); // apps/mobile/src/app/(worker)

describe('worker route honesty', () => {
  it('the "today" tab points at a screen file that exists', () => {
    expect(fs.existsSync(path.join(WORKER_DIR, 'today.tsx'))).toBe(true);
  });
});
