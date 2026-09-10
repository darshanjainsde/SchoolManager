import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsSection, { progressionPath } from './RecordsSection';
import RecordsTeaser, { homeLines } from './RecordsTeaser';
import type { RecordsBook } from '@/lib/public-api';

const book: RecordsBook = {
  generatedAt: '2026-09-10T00:00:00Z', nameFormat: 'FIRST_INITIAL', pageLayout: 'CABINET', showTopFive: true,
  lines: [
    { key: 'ath-100m|sen|Boys', sportKey: 'ath-100m', sportName: '100 m sprint', groupKey: 'sen', groupLabel: 'Senior', category: 'Boys', unit: 's', lowerIsBetter: true,
      record: { name: 'Rohan I.', text: '11.90 s', value: 11.9, year: 2023, setOn: '2023-11-02' },
      history: [{ name: 'A. M.', text: '12.40 s', value: 12.4, year: 1998, untilYear: 2007 }, { name: 'Kabir B.', text: '12.10 s', value: 12.1, year: 2007, untilYear: 2023 }],
      top: [{ rank: 1, name: 'Rohan I.', text: '11.90 s', value: 11.9, year: 2023 }, { rank: 2, name: 'Kabir B.', text: '12.10 s', value: 12.1, year: 2007 }, { rank: 3, name: 'Aarav M.', text: '12.22 s', value: 12.22, year: 2026 }] },
    { key: 'ath-long-jump|sen|Girls', sportKey: 'ath-long-jump', sportName: 'Long jump', groupKey: 'sen', groupLabel: 'Senior', category: 'Girls', unit: 'm', lowerIsBetter: false,
      record: null, history: [], top: [{ rank: 1, name: 'Isha B.', text: '4.51 m', value: 4.51, year: 2024 }] },
  ],
  home: ['ath-100m|sen|Boys', 'ath-long-jump|sen|Girls', 'nope|x|Boys'],
};

describe('RecordsSection — four rooms, one truth', () => {
  it.each(['CABINET', 'SCOREBOARD', 'REGISTER', 'PROGRESSION'] as const)('%s shows the verified record, the holder, and the all-time bests labelled apart', (layout) => {
    render(<RecordsSection book={book} layout={layout} showTopFive schoolName="Raffles" onOwnPage />);
    expect(screen.getAllByText(/11\.90 s/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rohan I\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/All-time bests/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Kabir B\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no record yet|No verified record/i).length).toBeGreaterThan(0);
    // the section's panels answer to the shape control (the Register is ruled paper by design and draws none)
    if (layout !== 'REGISTER') expect(document.querySelectorAll('.ps-panel').length).toBeGreaterThan(0);
  });

  it('the top five can be switched off, leaving the record and its history', () => {
    render(<RecordsSection book={book} layout="REGISTER" showTopFive={false} schoolName="Raffles" />);
    expect(screen.queryByText(/All-time bests/)).toBeNull();
    expect(screen.getByText(/Before:/)).toBeInTheDocument();
    expect(screen.getByText(/12\.40 s A\. M\., 1998/)).toBeInTheDocument();
  });

  it('sport chips filter the lines; an empty book says the book opens at the first meet', async () => {
    const u = userEvent.setup();
    render(<RecordsSection book={book} layout="CABINET" showTopFive schoolName="Raffles" />);
    await u.click(screen.getByRole('button', { name: 'Long jump' }));
    expect(screen.queryByRole('article', { name: /100 m sprint/ })).toBeNull();
    expect(screen.getByRole('article', { name: /Long jump/ })).toBeInTheDocument();
    expect(screen.getByText('Isha B.', { exact: false })).toBeInTheDocument();
    render(<RecordsSection book={{ ...book, lines: [], home: [] }} layout="CABINET" showTopFive schoolName="Raffles" />);
    expect(screen.getByText('The book opens at the first meet.')).toBeInTheDocument();
  });

  it('progression draws better as up, whichever way the sport counts, and ends on the record', () => {
    const p = progressionPath(book.lines[0]);
    expect(p.pts.map((x) => x.year)).toEqual([1998, 2007, 2023]);
    expect(p.pts[2].y).toBeLessThan(p.pts[0].y); // 11.90 sits above 12.40
    expect(p.pts[2].now).toBe(true);
    expect(progressionPath(book.lines[1]).pts).toEqual([]);
  });
});

describe('RecordsTeaser — the homepage band', () => {
  it('shows only the chosen lines that have a record, in the office order, and links to the book', () => {
    expect(homeLines(book).map((l) => l.key)).toEqual(['ath-100m|sen|Boys']);
    for (const layout of ['TILES', 'BOARD', 'CABINET'] as const) {
      const { unmount } = render(<RecordsTeaser book={book} layout={layout} />);
      expect(screen.getByText('11.90 s')).toBeInTheDocument();
      expect(screen.getByText(/Rohan I\./)).toBeInTheDocument();
      expect(screen.queryByText(/Long jump/)).toBeNull();
      expect(screen.getByRole('link', { name: /Full Book of Records/ })).toHaveAttribute('href', '/records');
      unmount();
    }
  });
  it('the strip is one link that reads every record out; nothing renders when no line has a record', () => {
    render(<RecordsTeaser book={book} layout="STRIP" />);
    expect(screen.getByRole('link', { name: /School records: 100 m sprint · 11\.90 s · Rohan I\., 2023/ })).toHaveAttribute('href', '/records');
    const { container } = render(<RecordsTeaser book={{ ...book, home: ['ath-long-jump|sen|Girls'] }} layout="TILES" />);
    expect(container.querySelector('section')).toBeNull();
  });
});
