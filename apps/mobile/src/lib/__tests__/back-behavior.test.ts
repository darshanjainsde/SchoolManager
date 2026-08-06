import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ANDROID BACK MUST WALK HOME, NOT SHUT THE APP.
 *
 * Every detail screen in this app is a HIDDEN TAB, not a pushed stack screen —
 * `take/[classSectionId]`, `results/[examId]`, `messages/[threadId]`,
 * `notes/[classSectionId]` are all declared as Tabs.Screen with href: null. A
 * tab navigator keeps no back stack, so with no explicit backBehavior the
 * hardware back button had nothing to pop and closed the app from the middle of
 * taking a register.
 *
 * `backBehavior="history"` makes back retrace the route actually taken —
 * Home → Attendance → Take, then back, back, back — instead of jumping or
 * exiting. It is one word that decides the whole behaviour, which is exactly
 * why it needs a test: nothing else in the suite would notice its removal.
 */
const layouts = [
  ['staff', 'src/app/(staff)/_layout.tsx'],
  ['family', 'src/app/(family)/_layout.tsx'],
  ['worker', 'src/app/(worker)/_layout.tsx'],
] as const;

describe('the hardware back button', () => {
  it.each(layouts)('%s tabs retrace history rather than exiting', (_name, rel) => {
    const src = readFileSync(join(__dirname, '../../..', rel), 'utf8');
    expect(src).toMatch(/backBehavior=["']history["']/);
  });
});
