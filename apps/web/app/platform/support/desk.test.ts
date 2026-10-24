// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPPORT_STATUSES } from '@skoolos/types';
import { OWNER_MOVES, ageLabel, hoursSince, ticketTone, type DeskTone } from './desk';

const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');

describe('the tone the desk paints with', () => {
  it('treats a day without an answer as more urgent than whatever stage it reached', () => {
    expect(ticketTone('IN_PROGRESS', 25)).toBe('bad');
    expect(ticketTone('OPEN', 30)).toBe('bad');
    expect(ticketTone('IN_PROGRESS', 23)).toBe('info');
    expect(ticketTone('IN_PROGRESS', null)).toBe('info');
  });

  it('separates what the school owes from what we owe', () => {
    expect(ticketTone('WAITING_ON_SCHOOL', null)).toBe('warn');
    expect(ticketTone('WAITING_ON_SCHOOL', null)).not.toBe(ticketTone('OPEN', null));
  });

  it('gives a finished ticket the settled colours', () => {
    expect(ticketTone('RESOLVED', null)).toBe('good');
    expect(ticketTone('CLOSED', null)).toBe('neutral');
  });

  it('still returns a readable tone for a status nobody mapped', () => {
    expect(ticketTone('SOME_FUTURE_STATUS', null)).toBe('neutral');
  });
});

describe('every tone it can return is one the stylesheet paints', () => {
  const produced = new Set<DeskTone>([
    ...SUPPORT_STATUSES.map((s) => ticketTone(s, null)),
    ...SUPPORT_STATUSES.map((s) => ticketTone(s, 30)),
  ]);
  it('produces more than one tone, or the test below proves nothing', () => {
    expect(produced.size).toBeGreaterThan(2);
  });
  it('has a row-stripe rule and a pill rule for each', () => {
    const missing = [...produced].filter((t) => !css.includes(`.sk-sup-row[data-tone='${t}']`) || !css.includes(`.sk-pill[data-tone="${t}"]`));
    expect(missing).toEqual([]);
  });
});

describe('the clocks', () => {
  it('reads minutes, hours and days the way the owner scans a board', () => {
    expect(ageLabel(0.5)).toBe('30 m');
    expect(ageLabel(5.4)).toBe('5 h');
    expect(ageLabel(47)).toBe('47 h');
    expect(ageLabel(72)).toBe('3 d');
  });
  it('never counts backwards', () => {
    expect(hoursSince(new Date(Date.now() + 60_000).toISOString())).toBe(0);
    expect(Math.round(hoursSince(new Date(Date.now() - 2 * 3_600_000).toISOString()))).toBe(2);
  });
});

describe('the moves the desk offers', () => {
  it('never offers a way out of CLOSED, and every target is a real status', () => {
    expect(OWNER_MOVES.CLOSED).toEqual([]);
    for (const s of SUPPORT_STATUSES) for (const t of OWNER_MOVES[s]) expect(SUPPORT_STATUSES).toContain(t);
  });
});
