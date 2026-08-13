import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CataloguePage from './page';
import type { TitleHit } from '@/lib/catalogue';

/**
 * One scenario, and it is the one that repriced the wrong book.
 *
 * `.lbx-detail` is `position: fixed`, not a modal — the results table stays
 * clickable behind it, so clicking another row IS how a librarian moves between
 * books. That only calls `setSelected`; the aside never unmounts. Without
 * `key={selected.id}` on `<ReplacementPrice>`, React reuses the instance, the
 * half-typed draft survives the switch, and Save sends it with the NEW title's
 * id.
 *
 * Driven through the page rather than the component because the defect lives in
 * how the page renders the component, which a component-level test cannot see.
 */

vi.mock('@/lib/session', () => ({
  readSession: () => ({ host: 'h', accessToken: 'tok', refreshToken: 'r' }),
}));

const searchTitlesMock = vi.hoisted(() => vi.fn());
const setReplacementPriceMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/catalogue')>()),
  searchTitles: searchTitlesMock,
  setReplacementPrice: setReplacementPriceMock,
}));

function hit(id: string, title: string, replacementPrice: TitleHit['replacementPrice']): TitleHit {
  return {
    id,
    isbn13: null,
    isbn10: null,
    title,
    subtitle: null,
    publisher: null,
    publishedYear: null,
    edition: null,
    language: 'en',
    callNumber: null,
    coverUrl: null,
    description: null,
    pageCount: null,
    replacementPrice,
    createdAt: '',
    updatedAt: '',
    rank: 0,
  };
}

const BOOK_A = hit('t1', 'The Hungry Tide', '450');
const BOOK_B = hit('t2', 'India After Gandhi', '1200');

describe('CataloguePage — the replacement-price field follows the selected book', () => {
  beforeEach(() => {
    searchTitlesMock.mockReset().mockResolvedValue([BOOK_A, BOOK_B]);
    setReplacementPriceMock.mockReset().mockResolvedValue({ id: 't2', replacementPrice: null });
  });

  it('abandons a half-typed price when the librarian clicks a different book', async () => {
    render(<CataloguePage />);

    // Open book A from its spine and start editing, without saving.
    fireEvent.click(await screen.findByRole('listitem', { name: 'The Hungry Tide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('textbox', { name: /cost to replace/i }), {
      target: { value: '299' },
    });

    // Click straight through to book B — the panel is not modal.
    fireEvent.click(screen.getByRole('listitem', { name: 'India After Gandhi' }));

    // The panel is now book B's, and it shows B's OWN price, read-only.
    expect(await screen.findByRole('heading', { name: 'India After Gandhi' })).toBeInTheDocument();
    expect(screen.getByText('₹1200.00')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /cost to replace/i })).not.toBeInTheDocument();

    // And nothing was written to either book.
    expect(setReplacementPriceMock).not.toHaveBeenCalled();
  });

  it('a save from the panel targets the book the panel is showing', async () => {
    render(<CataloguePage />);

    fireEvent.click(await screen.findByRole('listitem', { name: 'India After Gandhi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('textbox', { name: /cost to replace/i }), {
      target: { value: '1350' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setReplacementPriceMock).toHaveBeenCalledWith('h', 'tok', 't2', 1350),
    );
  });
});
