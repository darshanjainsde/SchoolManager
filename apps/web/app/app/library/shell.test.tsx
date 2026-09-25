import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { LibraryShell } from './shell';

let pathname = '/app/library';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

function render(base = '/app/library') {
  renderWithProviders(
    <LibraryShell base={base} subtitle="Circulation, the reading hall and fines.">
      <div>section body</div>
    </LibraryShell>,
  );
}

describe('LibraryShell — the section strip', () => {
  it('names the page once, for the tab it now is', () => {
    pathname = '/app/library';
    render();

    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument();
    expect(screen.getByText('section body')).toBeInTheDocument();
  });

  it('prefixes every section with the host shell base', () => {
    pathname = '/app/library';
    render('/app/library');

    const hrefs = [...screen.getByRole('navigation', { name: 'Library sections' }).querySelectorAll('a')].map(
      (a) => a.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/app/library',
      '/app/library/counter',
      '/app/library/hall',
      '/app/library/books',
      '/app/library/fines',
      '/app/library/settings',
    ]);
  });

  /**
   * The index route has to match EXACTLY. `startsWith` would light Dashboard up
   * on all six sections, which is the classic version of this bug — and it is
   * invisible until you look at the strip while standing on a sub-section.
   */
  it('marks only Dashboard active on the index route', () => {
    pathname = '/app/library';
    render();

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Counter' })).toHaveAttribute('data-active', 'false');
  });

  it('marks only Counter active on the counter route', () => {
    pathname = '/app/library/counter';
    render();

    expect(screen.getByRole('link', { name: 'Counter' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('link', { name: 'Counter' })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves the strip to the page column, not to a topbar width', () => {
    // A page strip must line up with the left-aligned pagehead above it. This
    // used to be corrected per page with an `.sk-lib-tabs` class, and the two
    // pages that forgot it (Pay, Alumni) drew the strip floating to the right
    // on any wide screen. Plain `.sk-tabs` is now the page shape, and the
    // 68rem centring belongs to `.sk-topbar .sk-tabs` — so the assertion is
    // that this nav carries NO width correction of its own.
    pathname = '/app/library';
    render();

    const nav = screen.getByRole('navigation', { name: 'Library sections' });
    expect(nav.className.trim()).toBe('sk-tabs');
  });
});
