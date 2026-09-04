import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVENT_ART_KEYS } from '@skoolos/types';
import { ART_KEYS, EVENT_ART, EventArt, guessArt } from './event-art';
import { EventCard, artOf, type SchoolEvent } from './event-card';

describe('choosing a cover from a title', () => {
  /**
   * The rule that is easy to get backwards. "Annual Sports Day" contains both
   * "annual" and "sports"; the SPECIFIC archetype has to win, or every event
   * with the word "day" in it becomes an annual day and the whole list looks
   * identical.
   */
  it('prefers the specific archetype over the broad one', () => {
    expect(guessArt('Annual Sports Day 2026')).toBe('sports');
    expect(guessArt('Annual Science Exhibition')).toBe('science');
    expect(guessArt('Annual Day 2026')).toBe('annual');
  });

  it('reads the Indian school calendar, not just English words', () => {
    expect(guessArt('Diwali Utsav')).toBe('festival');
    expect(guessArt('Independence Day assembly')).toBe('festival');
    expect(guessArt('Garba Night')).toBe('music');
    expect(guessArt('PTM · Class VI')).toBe('parents');
  });

  it('always returns something — an event is never left without a cover', () => {
    for (const title of ['', 'zzz', '???', 'Untitled']) {
      expect(ART_KEYS).toContain(guessArt(title));
    }
  });
});

/**
 * The API validates `coverArt` against EVENT_ART_KEYS in @skoolos/types; the
 * web app draws it. If the two lists ever drift, the API accepts a value the
 * app cannot draw and the poster comes out blank — which nothing else would
 * catch, because both halves compile perfectly on their own.
 */
describe('the shared key list and the drawings agree', () => {
  it('draws every key the API will accept', () => {
    expect([...ART_KEYS].sort()).toEqual([...EVENT_ART_KEYS].sort());
  });

  it('gives every archetype a full palette', () => {
    for (const k of ART_KEYS) {
      const p = EVENT_ART[k];
      expect(p.name, `${k} has no name`).toBeTruthy();
      expect(p.slug, `${k} has no slug`).toMatch(/^[a-z-]+$/);
      for (const c of [p.bg, p.ink, p.accent, p.alt]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('renders each one as an accessible image', () => {
    for (const k of ART_KEYS) {
      const { unmount } = render(<EventArt kind={k} />);
      expect(screen.getByRole('img', { name: `${EVENT_ART[k].name} cover art` })).toBeInTheDocument();
      unmount();
    }
  });
});

const EVENT: SchoolEvent = {
  id: 'e1', title: 'Annual Day 2026', startAt: '2026-03-14T11:30:00.000Z',
  venue: 'School auditorium', scope: 'SCHOOL', status: 'APPROVED', createdAt: '2026-01-01T00:00:00Z',
};

describe('the event card', () => {
  it('draws art when the school has uploaded no photo', () => {
    render(<EventCard event={EVENT} />);
    expect(screen.getByRole('img', { name: /cover art/ })).toBeInTheDocument();
  });

  /** A school that DID upload a photo must see its photo, not our drawing. */
  it('shows the uploaded photo when there is one', () => {
    const { container } = render(<EventCard event={{ ...EVENT, coverUrl: 'https://cdn.example/x.jpg' }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/x.jpg');
    expect(screen.queryByRole('img', { name: /cover art/ })).not.toBeInTheDocument();
  });

  it('honours a stored choice over the guess', () => {
    expect(artOf({ title: 'Annual Day 2026', coverArt: 'sports' })).toBe('sports');
    expect(artOf({ title: 'Annual Day 2026', coverArt: null })).toBe('annual');
  });

  it('leads with the date, because that is what a list is scanned for', () => {
    render(<EventCard event={EVENT} />);
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('Mar')).toBeInTheDocument();
  });

  it('offers the Promo Kit from the row — promoting is why the list exists', () => {
    render(<EventCard event={EVENT} />);
    expect(screen.getByRole('link', { name: 'Promo Kit' })).toHaveAttribute('href', '/app/events/e1/promo');
  });
});

/**
 * THE TILE-SIZE GUARD.
 *
 * A portrait photograph shipped a card twice the height of its neighbours and
 * broke the whole row's alignment. The cause: the image was left in flow with
 * `height: 100%`, which resolves against a height `aspect-ratio` has not
 * decided yet, so the picture sized the tile instead of the other way round.
 *
 * Layout is not computed in jsdom, so this reads the stylesheet — the same
 * approach `sk-theme.test.ts` uses. What matters is that the picture is taken
 * OUT OF FLOW; then it cannot have an opinion about the tile.
 */
describe('a picture can never resize its tile', () => {
  const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');

  /**
   * ONE rule's body, not "somewhere nearby".
   *
   * The first version of this sliced from `.sk-ev-cover` to `.sk-ev-when` and
   * asked whether `position: absolute` appeared anywhere inside. It does — the
   * crop-preview rules a few lines below use it — so the guard passed while the
   * bug it exists for was reinstated. A guard that reads its neighbours is not
   * a guard.
   */
  function ruleBody(selector: string): string {
    const at = css.indexOf(selector);
    expect(at, `${selector} is not in the stylesheet`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    return css.slice(open, css.indexOf('}', open));
  }
  const block = ruleBody('.sk-ev-cover {');

  it('fixes the cover window to 16:9 and clips it', () => {
    expect(block).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
    expect(block).toMatch(/overflow:\s*hidden/);
  });

  it('takes both the drawing and the photo out of flow', () => {
    const rule = ruleBody('.sk-ev-cover > svg,');
    expect(rule, 'the cover children must be positioned absolutely').toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule, 'a photo that is not cover-fitted is stretched').toMatch(/object-fit:\s*cover/);
  });

  it('honours the focal choice in CSS as well as on the sheets', () => {
    expect(ruleBody('.sk-ev-cover > img[data-focus="top"]')).toMatch(/object-position:\s*50% 0%/);
    expect(ruleBody('.sk-ev-cover > img[data-focus="bottom"]')).toMatch(/object-position:\s*50% 100%/);
  });
});

describe('the card carries the focal choice', () => {
  it('marks a photo with the band the school picked', () => {
    const { container } = render(
      <EventCard event={{ ...EVENT, coverUrl: 'https://cdn.example/tall.jpg', coverFocus: 'top' }} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('data-focus', 'top');
  });

  it('defaults to the middle, which is what a browser does anyway', () => {
    const { container } = render(<EventCard event={{ ...EVENT, coverUrl: 'https://cdn.example/tall.jpg' }} />);
    expect(container.querySelector('img')).toHaveAttribute('data-focus', 'middle');
  });
});
