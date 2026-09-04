// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { queueTone, FILTERS, type QueueTone } from './queue';

const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');

const EVERY_STATUS = [
  'REQUESTED', 'QUOTED', 'CONFIRMED', 'PRINTING',
  'DISPATCHED', 'DELIVERED', 'DECLINED', 'CANCELLED',
];

describe('the queue tone the desk paints with', () => {
  it('treats lateness as more urgent than whatever stage it reached', () => {
    // An order can be PRINTING and still be a fire.
    expect(queueTone('PRINTING', 3)).toBe('bad');
    expect(queueTone('DISPATCHED', 1)).toBe('bad');
    expect(queueTone('PRINTING', null)).not.toBe('bad');
  });

  it('does not call an order late when it is exactly on the promised day', () => {
    expect(queueTone('PRINTING', 0)).toBe('info');
  });

  it('gives a finished order the settled colour', () => {
    expect(queueTone('DELIVERED', null)).toBe('good');
  });

  it('separates what we owe from what the school owes', () => {
    // If both piles read the same, the tabs stop being a work queue.
    expect(queueTone('REQUESTED', null)).not.toBe(queueTone('QUOTED', null));
  });

  it('still returns a readable tone for a status nobody mapped', () => {
    expect(queueTone('SOME_FUTURE_STATUS', null)).toBe('neutral');
  });
});

describe('every tone it can return is one the stylesheet paints', () => {
  // The bug this exists for: the card stripe was written with tones
  // ('wait', 'live', 'done', 'late') that queueTone never returns, so every
  // card drew the default grey edge. A data-tone the CSS does not match is
  // silent — the attribute is valid, it simply selects nothing.
  const produced = new Set<QueueTone>([
    ...EVERY_STATUS.map((s) => queueTone(s, null)),
    ...EVERY_STATUS.map((s) => queueTone(s, 4)),
  ]);

  it('produces more than one tone, or the test below proves nothing', () => {
    expect(produced.size).toBeGreaterThan(2);
  });

  it('has a card-stripe rule for each', () => {
    const missing = [...produced].filter(
      (t) => !css.includes(`.sk-own-order[data-tone='${t}']`),
    );
    expect(missing).toEqual([]);
  });

  it('has a pill rule for each', () => {
    const missing = [...produced].filter(
      (t) => !css.includes(`.sk-pill[data-tone="${t}"]`),
    );
    expect(missing).toEqual([]);
  });
});

describe('the filter rail', () => {
  it('ends with the catch-all, so no order is unreachable', () => {
    expect(FILTERS[FILTERS.length - 1].key).toBe('');
  });

  it('names a real status for every pile except that catch-all', () => {
    const keys = FILTERS.map((f) => f.key).filter(Boolean);
    expect(keys.every((k) => EVERY_STATUS.includes(k))).toBe(true);
  });

  it('opens on the pile that earns money', () => {
    expect(FILTERS[0].key).toBe('REQUESTED');
  });
});
