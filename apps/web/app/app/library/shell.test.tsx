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

  it('does not inherit the portal topbar strip centring', () => {
    // `.sk-tabs` centres itself at 68rem for the phone-first portals. Inside a
    // page — under a left-aligned pagehead — that floats the strip away from the
    // heading on any wide screen. `.sk-lib-tabs` is what corrects it.
    pathname = '/app/library';
    render();

    expect(screen.getByRole('navigation', { name: 'Library sections' })).toHaveClass('sk-lib-tabs');
  });
});
