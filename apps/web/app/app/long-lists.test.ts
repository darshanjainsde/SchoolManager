// @vitest-environment node
//
// A LONG LIST SCROLLS INSIDE ITS OWN BOX.
//
// Availability listed every free teacher straight down the page: the panel it
// sits in is `position: sticky`, so a 40-name list ran past the bottom of the
// screen and the page itself grew by a screen and a half every time an hour
// was picked. The owner's words: "a long list of teacher appears that too with
// bad long list and bad scroll interface — lock the box on screen and provide
// the scroll inside it."
//
// The standard is `ScrollBox` (components/ui/kit.tsx) + `.sk-scrollbox`. This
// reads the source, because nothing else can see a list that is merely long.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('app/sk-theme.css');
const kit = read('components/ui/kit.tsx');

describe('the ScrollBox standard', () => {
  it('caps its height at the viewport as well as its own max, so a sticky panel cannot run off the screen', () => {
    expect(css).toMatch(/\.sk-scrollbox \{[\s\S]*max-height: min\(var\(--sk-scroll-max, 420px\), calc\(100vh - 220px\)\)/);
  });
  it('scrolls only itself — a wheel inside it must not scroll the page behind', () => {
    expect(css).toMatch(/\.sk-scrollbox \{[\s\S]*overscroll-behavior: contain/);
  });
  it('keeps the scrollbar gutter, so the rows do not shift when the bar appears', () => {
    expect(css).toMatch(/\.sk-scrollbox \{[\s\S]*scrollbar-gutter: stable/);
  });
  it('is reachable and visible to the keyboard', () => {
    expect(kit).toMatch(/tabIndex=\{0\}/);
    expect(kit).toMatch(/role="region"/);
    expect(css).toMatch(/\.sk-scrollbox:focus-visible/);
  });
  it('demands a label, so a screen reader can name the region it lands in', () => {
    expect(kit).toMatch(/export function ScrollBox\(\{[^}]*label[^}]*\}: \{[\s\S]*?label: string;/);
  });
});

describe('the screens that hold a long list use it', () => {
  const availability = read('app/app/availability/page.tsx');
  it('availability: the free-teacher list and the matched-teacher list both scroll in their own box', () => {
    expect(availability).toMatch(/import \{ ScrollBox \} from '@\/components\/ui\/kit'/);
    expect((availability.match(/<ScrollBox/g) ?? []).length).toBe(2);
  });
  it('availability: each box says how long it is on the OUTSIDE — a scrolling region must name its own size', () => {
    // "28 of 73 teachers free" above the box, and the box's own aria-label.
    expect(availability).toMatch(/\{selectedFree\.length\} of \{teachers\.length\} teachers free/);
    expect(availability).toMatch(/label=\{`\$\{selectedFree\.length\} teachers free`\}/);
    expect(availability).toMatch(/\{found\.length\} \{found\.length === 1 \? 'teacher matches' : 'teachers match'\}/);
  });
});
