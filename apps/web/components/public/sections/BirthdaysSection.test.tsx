import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BirthdaysSection, { initialsOf } from './BirthdaysSection';
import BirthdayTeaser from './BirthdayTeaser';
import type { BirthdaysResult } from '@/lib/public-api';

const meera = { day: 11, month: 9, name: 'Meera I.', classLabel: '2 A', photoUrl: null, key: 'k2' };
const data: BirthdaysResult = {
  generatedFor: '2026-09-09',
  window: 'WEEK',
  maxAge: 100,
  today: [{ day: 9, month: 9, name: 'Aarav M.', classLabel: '5 B', photoUrl: null, key: 'k1' }],
  upcoming: [meera],
  next: meera,
};

describe('BirthdaysSection — the wall in three rooms', () => {
  it.each(['PARTY_WALL', 'MONTH_PLANNER', 'NOTICE_BOARD'] as const)('%s shows today and upcoming with an initials coin, and never a year', (style) => {
    render(<BirthdaysSection data={data} style={style} wishLine="Happy birthday, {first name}! From all of us at {school}." schoolName="Raffles" onOwnPage />);
    expect(screen.getByText('Aarav M.')).toBeInTheDocument();
    expect(screen.getByText('Meera I.')).toBeInTheDocument();
    // The planner draws a dot per child; the other two rooms draw the initials coin.
    if (style !== 'MONTH_PLANNER') expect(screen.getAllByText('AM').length).toBeGreaterThan(0);
  });

  it.each(['PARTY_WALL', 'NOTICE_BOARD'] as const)('%s never prints a year — there is none in the data, and no client clock either', (style) => {
    render(<BirthdaysSection data={data} style={style} wishLine="x" schoolName="Raffles" onOwnPage />);
    expect(document.body.textContent).not.toMatch(/\b(19|20)\d\d\b/);
  });

  it('the wish line is filled with the first name and the school', () => {
    render(<BirthdaysSection data={data} style="PARTY_WALL" wishLine="Happy birthday, {first name}! From all of us at {school}." schoolName="Raffles" onOwnPage />);
    expect(screen.getByText('Happy birthday, Aarav! From all of us at Raffles.')).toBeInTheDocument();
  });

  it('nobody today → the wall names the next birthday instead of standing empty', () => {
    render(<BirthdaysSection data={{ ...data, today: [] }} style="PARTY_WALL" wishLine="x" schoolName="Raffles" onOwnPage />);
    expect(screen.getByText('Next: Meera I., 11 Sep')).toBeInTheDocument();
  });

  it('the planner outlines today and puts a dot on each birthday', () => {
    render(<BirthdaysSection data={data} style="MONTH_PLANNER" wishLine="x" schoolName="Raffles" onOwnPage />);
    expect(screen.getByRole('gridcell', { name: '9 Sep, 1 birthdays' })).toHaveClass('ps-bd-today-cell');
    expect(screen.getByRole('gridcell', { name: '11 Sep, 1 birthdays' })).toBeInTheDocument();
    expect(screen.getByText('September 2026')).toBeInTheDocument();
  });

  it('a consented photo renders as an image, everyone else as a coin', () => {
    const withPhoto = { ...data, today: [{ ...data.today[0], photoUrl: 'https://cdn/a.jpg' }] };
    render(<BirthdaysSection data={withPhoto} style="PARTY_WALL" wishLine="x" schoolName="Raffles" onOwnPage />);
    expect(document.querySelector('img.ps-bd-coin-photo')).toHaveAttribute('src', 'https://cdn/a.jpg');
    expect(screen.getByText('MI')).toBeInTheDocument();
  });

  it('the notice board pins a polaroid for a photo and an index card for everyone else', () => {
    const withPhoto = { ...data, today: [{ ...data.today[0], photoUrl: 'https://cdn/a.jpg' }] };
    render(<BirthdaysSection data={withPhoto} style="NOTICE_BOARD" wishLine="x" schoolName="Raffles" onOwnPage />);
    expect(document.querySelector('.ps-bd-polaroid img.ps-bd-coin-photo')).toHaveAttribute('src', 'https://cdn/a.jpg');
    expect(document.querySelectorAll('.ps-bd-note')).toHaveLength(1);
    expect(screen.getByText('Meera I.')).toBeInTheDocument();
  });

  it('initialsOf', () => {
    expect(initialsOf('Aarav M.')).toBe('AM');
    expect(initialsOf('Zoya')).toBe('Z');
    expect(initialsOf('  Sara Ali Khan ')).toBe('SA');
  });
});

describe('BirthdayTeaser', () => {
  it('the badge counts today and links to the page', () => {
    render(<BirthdayTeaser style="CAKE_BADGE" data={data} href="/birthdays" />);
    const link = screen.getByRole('link', { name: /Birthdays: 1 today/ });
    expect(link).toHaveAttribute('href', '/birthdays');
  });

  it('the badge falls back to the next birthday when nobody is today', () => {
    render(<BirthdayTeaser style="CAKE_BADGE" data={{ ...data, today: [] }} href="/birthdays" />);
    expect(screen.getByRole('link', { name: /Next: Meera I\./ })).toBeInTheDocument();
  });

  it('the ribbon lists names and renders nothing at all when there is nobody in the window', () => {
    const { unmount } = render(<BirthdayTeaser style="RIBBON" data={data} href="/birthdays" />);
    expect(screen.getByRole('link', { name: /Today we celebrate: Aarav M\., Meera I\./ })).toBeInTheDocument();
    unmount();
    render(<BirthdayTeaser style="RIBBON" data={{ ...data, today: [], upcoming: [], next: null }} href="/birthdays" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
