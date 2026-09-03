import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
