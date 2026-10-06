import * as fs from 'fs';
import * as path from 'path';
import { MORE_ITEMS as FAMILY_TOOLS } from '../family-nav';
import { MORE_ITEMS as STAFF_TOOLS } from '../staff-nav';

/**
 * Every tool a portal lists must be reachable from a screen a person can open.
 *
 * route-honesty proves each tool's route FILE exists. It cannot prove anybody
 * can GET there: when the drawer gave way to the home grids (pitch №5), the
 * grids were hand-picked lists, and the Complaint Box — "always drawn: a family
 * that cannot find it will use WhatsApp instead" — was drawn on neither home.
 * Families and class teachers could open it only from a notification. Found on
 * 2026-10-07 walking vc23 for the Play review, where the store listing promises
 * it.
 *
 * A tool counts as reachable when its label or its route appears in the
 * portal's Home or Profile screen source (the grids name tools by label when
 * they filter the shared list, by route when they spell one out).
 */
const APP = path.join(__dirname, '..', '..', 'app');
const src = (rel: string) => fs.readFileSync(path.join(APP, rel), 'utf8');

type Tool = { readonly label: string; readonly route: string };
const SURFACES: [string, readonly Tool[], string[]][] = [
  ['family', FAMILY_TOOLS, ['(family)/(tabs)/home/index.tsx', '(family)/(tabs)/profile/index.tsx']],
  ['teacher', STAFF_TOOLS, ['(staff)/(tabs)/home/index.tsx', '(staff)/(tabs)/profile/index.tsx']],
];

describe.each(SURFACES)('%s portal', (_name, tools, screens) => {
  const text = screens.map(src).join('\n');
  it.each(tools.map((t) => [t.label, t.route]))('"%s" can be opened from Home or Profile', (label, route) => {
    const reachable = text.includes(`'${label}'`) || text.includes(`'${route}'`);
    expect({ label, reachable }).toEqual({ label, reachable: true });
  });
});
