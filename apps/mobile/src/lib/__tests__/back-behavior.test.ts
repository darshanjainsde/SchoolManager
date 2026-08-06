import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ANDROID BACK MUST WALK HOME, NOT SHUT THE APP.
 *
 * Detail screens — take/[classSectionId], results/[examId], messages/[threadId],
 * notes/[classSectionId] and the drawer tools — used to be declared as hidden
 * tabs (`Tabs.Screen` with `href: null`). A tab navigator keeps no back stack,
 * so back had nothing to pop and closed the app from the middle of taking a
 * register.
 *
 * They are pushed Stack screens now, which is what makes back pop, the
 * edge-swipe gesture work, and screens slide in instead of appearing. These
 * tests pin all three halves of that arrangement, because nothing else in the
 * suite would notice any of them being undone.
 */
function read(rel: string): string {
  return readFileSync(join(__dirname, '../../..', rel), 'utf8');
}

/**
 * Source with comments removed. These layouts EXPLAIN the old hidden-tab
 * arrangement in prose, so a naive search for `href: null` finds the
 * explanation and reports the bug it is describing.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Navigators that still hold real tabs, where back means "previous tab". */
const tabLayouts = [
  ['staff', 'src/app/(staff)/(tabs)/_layout.tsx'],
  ['family', 'src/app/(family)/(tabs)/_layout.tsx'],
  // The worker portal is a single tab with no detail screens, so it keeps the
  // plain tab navigator — there is nothing for it to push.
  ['worker', 'src/app/(worker)/_layout.tsx'],
] as const;

/** Portals whose detail screens push over the tabs. */
const stackLayouts = [
  ['staff', 'src/app/(staff)/_layout.tsx'],
  ['family', 'src/app/(family)/_layout.tsx'],
] as const;

describe('moving between tabs', () => {
  it.each(tabLayouts)('%s tabs retrace history rather than exiting', (_name, rel) => {
    expect(read(rel)).toMatch(/backBehavior=["']history["']/);
  });
});

describe('leaving a detail screen', () => {
  it.each(stackLayouts)('%s pushes detail screens onto a Stack', (_name, rel) => {
    const src = read(rel);
    expect(src).toMatch(/<Stack\b/);
  });

  it.each(stackLayouts)(
    '%s anchors the stack to the tabs, so a push notification is not a dead end',
    (_name, rel) => {
      // Landing straight on a thread from a notification leaves no history.
      // Without an anchor, the first back press exits the app — the very bug
      // this restructure removed, reintroduced through the side door.
      expect(read(rel)).toMatch(/initialRouteName:\s*['"]\(tabs\)['"]/);
    },
  );

  it.each(stackLayouts)('%s declares no detail screen as a hidden tab', (_name, rel) => {
    // `href: null` is how a screen gets parked in a tab navigator with no back
    // stack. Its return anywhere in these layouts means detail screens have
    // silently gone back to being tabs.
    expect(code(rel)).not.toMatch(/href:\s*null/);
  });
});
