import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The 10-minute GitHub workflow that calls the drain. Its header once said
 * overlapping runs would double-send; since the drain claims rows and
 * deliveries that is false, and a stale reason is how the next person "fixes"
 * the wrong thing. One run at a time is still kept, so a slow run's call loop
 * is never doubled by the next tick.
 */
const WORKFLOW = readFileSync(join(__dirname, '..', '..', '..', '..', '..', '.github', 'workflows', 'outbox-drain.yml'), 'utf8');

describe('outbox-drain workflow', () => {
  it('runs one at a time and never cancels a run mid-drain', () => {
    expect(WORKFLOW).toMatch(/^concurrency:\n {2}group: outbox-drain\n {2}cancel-in-progress: false$/m);
  });

  it('no longer claims the drain has no row claiming', () => {
    expect(WORKFLOW).not.toMatch(/no\s+#?\s*row-claiming/);
    expect(WORKFLOW).not.toMatch(/would double-send/);
    expect(WORKFLOW).toMatch(/SKIP LOCKED/);
  });

  it('says scheduled runs come from main and hit the production API', () => {
    expect(WORKFLOW).toMatch(/scheduled runs come from main and hit the PRODUCTION API/);
  });
});
