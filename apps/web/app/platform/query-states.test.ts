// @vitest-environment node
//
// Every console page must render SOMETHING for every query state.
//
// The bug this guards: `{query.isLoading && <spinner>}` plus
// `{query.data && <content>}` looks exhaustive and is not. React Query leaves
// a third state — not loading, not errored, no data — whenever a query is
// disabled, or is sitting between retries after a failure. The page then
// renders its header and nothing else.
//
// That shipped. A 503 from /owner/marketing-config (the API was fine; the
// Prisma pool was exhausted by a different endpoint) put the Settings page in
// exactly that state, and it showed a title over an empty page with no
// message, no spinner and no way to retry. It read as "there is nothing here",
// not "this failed".
//
// The fix is to key the fallback off the ABSENCE OF DATA rather than off
// isLoading, so the three states are genuinely covered.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGES = [
  ['dashboard', 'app/platform/page.tsx', 'overview', 'overview.data'],
  ['leads', 'app/platform/leads/page.tsx', 'leads', 'leads.data'],
  ['settings', 'app/platform/settings/page.tsx', 'config', 'form'],
] as const;

describe.each(PAGES)('%s page covers every query state', (_name, file, query, dataVar) => {
  const src = readFileSync(resolve(process.cwd(), file), 'utf8');

  it('does not gate its only fallback on isLoading', () => {
    // `isLoading` is false while a failed query waits to retry, so a page whose
    // sole fallback is `isLoading &&` has a hole exactly when things are worst.
    expect(src).not.toMatch(new RegExp(`\\{${query}\\.isLoading && <p`));
  });

  it('shows a fallback whenever there is no data and no error', () => {
    const guard = new RegExp(`!${dataVar.replace('.', '\\.')} && !${query}\\.error`);
    expect(src).toMatch(guard);
  });

  it('offers a retry when the query failed, rather than a dead end', () => {
    const errBlock = src.slice(src.indexOf(`${query}.error &&`));
    expect(errBlock.slice(0, 900)).toContain(`${query}.refetch()`);
  });
});
