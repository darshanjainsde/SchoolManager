import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Settings audit, 11 Oct 2026: six unrelated cards sat in one `.sk-grid2`,
 * whose rows stretched every card to its tallest neighbour, and the delivery
 * logs grew the page by 20+ rows. Every Settings tab is now one column of
 * SettingsSection, and logs open behind a button. This keeps it that way.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) ? [p] : [];
  });
}
const SRC = files(__dirname).map((p) => ({ p, s: readFileSync(p, 'utf8') }));

describe('Settings layout guard', () => {
  it('no Settings tab uses the stretching card grid', () => {
    expect(SRC.filter(({ s }) => /sk-grid2|className="sk-card"/.test(s)).map(({ p }) => p)).toEqual([]);
  });
  it('every tab page builds from SettingsSection', () => {
    const pages = SRC.filter(({ p }) => /page\.tsx$/.test(p));
    expect(pages.length).toBe(3);
    for (const { p, s } of pages) {
      const usesSections = /SettingsSection|ClassNotesSection|EmailSettings|WhatsAppSettings/.test(s);
      expect({ p, usesSections }).toEqual({ p, usesSections: true });
    }
  });
  it('delivery logs render only inside an Overlay', () => {
    for (const id of ['email-recent', 'whatsapp-recent']) {
      const owner = SRC.find(({ s }) => s.includes(`data-testid="${id}"`));
      expect(owner).toBeDefined();
      const at = owner!.s.indexOf(`data-testid="${id}"`);
      const before = owner!.s.slice(0, at);
      expect(before.lastIndexOf('<Overlay')).toBeGreaterThan(before.lastIndexOf('</Overlay>'));
    }
  });
});
