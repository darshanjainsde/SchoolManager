import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HallOfFame, { HOF_LAYOUTS, hofHasEntries } from './HallOfFame';
import type { PublicHallOfFame } from '@/lib/public-api';

const entry = (batchYear: number, rank: number, name: string, achievement: string | null = null) => ({
  batchYear,
  rank,
  name,
  achievement,
  photoUrl: null,
});

/** Two groups, three batches. Class 3 has every year; Board toppers only 2024. */
const HOF: PublicHallOfFame = {
  landingYear: 2025,
  years: [2025, 2024, 2023],
  groups: [
    {
      id: 'g-class-3',
      label: 'Class 3',
      entries: [
        entry(2025, 1, 'Ved Sharma', '99%'),
        entry(2025, 2, 'Kirti Rao', '98.5%'),
        entry(2025, 3, 'Ansh Mehta', '98%'),
        entry(2024, 1, 'Anaya Iyer', '98.6% · CBSE'),
        entry(2023, 1, 'Reyansh Nair'),
      ],
    },
    { id: 'g-board', label: 'Board toppers', entries: [entry(2024, 1, 'Tara Bose', '98%')] },
  ],
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('HallOfFame', () => {
  it('knows when there is nothing to show', () => {
    expect(hofHasEntries(null)).toBe(false);
    expect(hofHasEntries({ landingYear: 2025, years: [2025], groups: [{ id: 'g', label: 'x', entries: [] }] })).toBe(false);
    expect(hofHasEntries(HOF)).toBe(true);
  });

  it('opens on the landing batch and lists a chip per batch', () => {
    render(<HallOfFame hof={HOF} />);
    expect(screen.getByRole('button', { name: '2025-26' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2023-24' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Ved Sharma')).toBeInTheDocument();
    // Board toppers has no 2025 podium, so it is not offered for 2025 — but the one class that has one is still named.
    expect(screen.queryByRole('button', { name: 'Board toppers' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Class 3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switching the batch swaps the podium and offers the groups that have one that year', () => {
    render(<HallOfFame hof={HOF} />);
    fireEvent.click(screen.getByRole('button', { name: '2024-25' }));
    expect(screen.getByText('Anaya Iyer')).toBeInTheDocument();
    expect(screen.queryByText('Ved Sharma')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Board toppers' }));
    expect(screen.getByText('Tara Bose')).toBeInTheDocument();
    expect(window.location.search).toBe('?batch=2024');
  });

  it('honours a shared ?batch= link after mount', () => {
    window.history.replaceState(null, '', '/?batch=2023');
    render(<HallOfFame hof={HOF} />);
    expect(screen.getByText('Reyansh Nair')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2023-24' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a ?batch= that has no entries', () => {
    window.history.replaceState(null, '', '/?batch=2011');
    render(<HallOfFame hof={HOF} />);
    expect(screen.getByText('Ved Sharma')).toBeInTheDocument();
  });

  it.each(HOF_LAYOUTS)('layout %s names all three places', (layout) => {
    const { container } = render(<HallOfFame hof={HOF} layout={layout} />);
    expect(container.querySelector('section')?.getAttribute('data-layout')).toBe(layout);
    for (const name of ['Ved Sharma', 'Kirti Rao', 'Ansh Mehta']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it('the timeline shows every batch of the chosen group at once, so it has no batch chips', () => {
    render(<HallOfFame hof={HOF} layout="TIMELINE" />);
    expect(screen.queryByRole('group', { name: 'Batch' })).toBeNull();
    expect(screen.getByText('Anaya Iyer')).toBeInTheDocument();
    expect(screen.getByText('Reyansh Nair')).toBeInTheDocument();
  });

  it('falls back to the podium for an unknown layout', () => {
    const { container } = render(<HallOfFame hof={HOF} layout="NOPE" />);
    expect(container.querySelector('section')?.getAttribute('data-layout')).toBe('PODIUM');
  });

  it('the scoreboard reads a percentage out of the achievement', () => {
    render(<HallOfFame hof={HOF} layout="SCOREBOARD" />);
    expect(screen.getByText('99%')).toBeInTheDocument();
    expect(screen.getByText('98.5%')).toBeInTheDocument();
  });
});

describe('batches read as academic sessions', () => {
  it('labels chips and captions the CBSE way (2025-26) while the link keeps the start year', () => {
    render(<HallOfFame hof={HOF} />);
    expect(screen.getByRole('button', { name: '2025-26' })).toBeInTheDocument();
    expect(screen.getByText('99% · 2025-26')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2024-25' }));
    expect(window.location.search).toBe('?batch=2024');
  });
});

describe('the band takes part in the page like every other band', () => {
  it('carries data-sec so Deck, Snap and the scroll-driven feels include it, and the per-band class', () => {
    const { container } = render(<HallOfFame hof={HOF} bandClass="ps-v-hof-podium ps-sg-rise" />);
    const sec = container.querySelector('section#hall-of-fame');
    expect(sec?.getAttribute('data-sec')).toBe('hof');
    expect(sec?.className).toContain('ps-sg-rise');
  });
});
