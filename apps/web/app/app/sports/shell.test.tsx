import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SportsShell } from './shell';

let pathname = '/app/sports';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

function render(base = '/app/sports') {
  renderWithProviders(
    <SportsShell base={base} subtitle="Tournaments, the Book of Records and the house table.">
      <div>section body</div>
    </SportsShell>,
  );
}

describe('SportsShell — the section strip', () => {
  it('names the page once and prefixes every section with the host base; the console door alone shows Teachers', () => {
    pathname = '/app/sports';
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Sports' })).toBeInTheDocument();
    const hrefs = [...screen.getByRole('navigation', { name: 'Sports sections' }).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/app/sports', '/app/sports/records', '/app/sports/houses', '/app/sports/rules', '/app/sports/settings', '/app/sports/teachers']);
  });

  it('the teacher door has no Teachers tab', () => {
    pathname = '/sports';
    render('/sports');
    const hrefs = [...screen.getByRole('navigation', { name: 'Sports sections' }).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/sports', '/sports/records', '/sports/houses', '/sports/rules', '/sports/settings']);
  });

  it('marks only Tournaments active on the index route and on a tournament page; only Rules on /rules', () => {
    pathname = '/app/sports';
    render();
    expect(screen.getByRole('link', { name: 'Tournaments' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('data-active', 'false');
  });

  it('a tournament page keeps Tournaments lit', () => {
    pathname = '/app/sports/tournaments/abc';
    render();
    expect(screen.getByRole('link', { name: 'Tournaments' })).toHaveAttribute('data-active', 'true');
    pathname = '/sports/rules';
    render('/sports');
    expect(screen.getAllByRole('link', { name: 'Rules' }).at(-1)).toHaveAttribute('data-active', 'true');
  });
});
