import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ReplacementPrice } from './ReplacementPrice';
import type { TitleHit } from '@/lib/catalogue';
import { ApiError } from '@/lib/api';

/**
 * This component has no other coverage: `tsc` proves it compiles and the lib
 * test proves the request shape, but neither renders it, and the edit → save →
 * clear → cancel state machine is exactly where a stale-state or wrong-handler
 * bug lives invisibly. Two such bugs were caught while writing it (a
 * `setDraft('')`-then-read-`draft` staleness, and `onClick={submit}` handing
 * the MouseEvent in as the value); this file is what stops them coming back.
 */

vi.mock('@/lib/session', () => ({
  readSession: () => ({ host: 'h', accessToken: 'tok', refreshToken: 'r' }),
}));

const setReplacementPriceMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/catalogue')>()),
  setReplacementPrice: setReplacementPriceMock,
}));

function titleWith(replacementPrice: TitleHit['replacementPrice']): TitleHit {
  return {
    id: 't1',
    isbn13: null,
    isbn10: null,
    title: 'The Hungry Tide',
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

describe('ReplacementPrice', () => {
  beforeEach(() => {
    setReplacementPriceMock.mockReset();
    setReplacementPriceMock.mockResolvedValue({ id: 't1', replacementPrice: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('says "Not set" in words when there is no price, never an empty box', () => {
    // An empty input reads as "loading" or as zero, and zero means something
    // else entirely here (a book written off at ₹0). Unpriced is a state the
    // product says out loud.
    render(<ReplacementPrice title={titleWith(null)} onSaved={() => {}} />);
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a price' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the amount and a Change affordance when a price is set', () => {
    render(<ReplacementPrice title={titleWith('299')} onSaved={() => {}} />);
    expect(screen.getByText('₹299.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('shows ₹0.00 for a zero price rather than falling back to "Not set"', () => {
    // A book written off as out of print is settled at ₹0 deliberately. Any
    // truthiness check on the way to this render turns that into "unpriced".
    render(<ReplacementPrice title={titleWith(0)} onSaved={() => {}} />);
    expect(screen.getByText('₹0.00')).toBeInTheDocument();
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
  });

  it('saves a typed amount as a number', async () => {
    const onSaved = vi.fn();
    setReplacementPriceMock.mockResolvedValue({ id: 't1', replacementPrice: '349.5' });

    render(<ReplacementPrice title={titleWith(null)} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a price' }));
    fireEvent.change(screen.getByRole('textbox', { name: /cost to replace/i }), { target: { value: '349.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(setReplacementPriceMock).toHaveBeenCalledWith('h', 'tok', 't1', 349.5));
    expect(onSaved).toHaveBeenCalledWith('349.5');
    expect(await screen.findByText('Cost to replace saved.')).toBeInTheDocument();
  });

  it('regression: the Save button does not pass its MouseEvent in as the value', async () => {
    // `onClick={submit}` compiles under a defaulted parameter and hands the
    // React event to it, which stringifies to "[object MouseEvent]" and makes
    // every save fail validation. Caught by tsc once; pinned here because the
    // shape that reintroduces it is a one-character edit.
    render(<ReplacementPrice title={titleWith(null)} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a price' }));
    fireEvent.change(screen.getByRole('textbox', { name: /cost to replace/i }), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(setReplacementPriceMock).toHaveBeenCalled());
    expect(setReplacementPriceMock.mock.calls[0][3]).toBe(250);
  });

  it('clears the price via the Clear button, after confirming', async () => {
    // Regression for the staleness bug: Clear used to setDraft('') and then
    // read `draft` in the same tick, so it re-saved the OLD value instead of
    // clearing. The assertion that matters is `null`, not merely "was called".
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ReplacementPrice title={titleWith('2999')} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(setReplacementPriceMock).toHaveBeenCalledWith('h', 'tok', 't1', null));
    expect(await screen.findByText('Cost to replace cleared.')).toBeInTheDocument();
  });

  it('does not clear when the confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ReplacementPrice title={titleWith('2999')} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(setReplacementPriceMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range or malformed amount without calling the API', async () => {
    render(<ReplacementPrice title={titleWith(null)} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a price' }));

    const input = screen.getByRole('textbox', { name: /cost to replace/i });
    fireEvent.change(input, { target: { value: '299000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/between 0 and 100000/);
    expect(setReplacementPriceMock).not.toHaveBeenCalled();
  });

  it('rejects more than two decimal places', async () => {
    render(<ReplacementPrice title={titleWith(null)} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a price' }));
    fireEvent.change(screen.getByRole('textbox', { name: /cost to replace/i }), { target: { value: '299.999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(setReplacementPriceMock).not.toHaveBeenCalled();
  });

  it('surfaces an API failure instead of pretending the save worked', async () => {
    // The REAL ApiError, not a stand-in: the component branches on
    // `err instanceof ApiError` to decide whether the librarian sees the API's
    // own message or a generic fallback, and a stand-in silently takes the
    // fallback branch — so the test would pass either way.
    setReplacementPriceMock.mockRejectedValue(
      new ApiError(400, 'replacementPrice must not be less than 0'),
    );

    render(<ReplacementPrice title={titleWith(null)} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a price' }));
    fireEvent.change(screen.getByRole('textbox', { name: /cost to replace/i }), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The API's own message must reach the librarian — 'Try again' hides
    // which field the server rejected and why.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'replacementPrice must not be less than 0',
    );
    // Still in edit mode, with the typed value intact — a failed save must not
    // discard what the librarian typed.
    expect(screen.getByRole('textbox', { name: /cost to replace/i })).toHaveValue('10');
  });

  it('cancel leaves the stored price untouched', async () => {
    render(<ReplacementPrice title={titleWith('299')} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(setReplacementPriceMock).not.toHaveBeenCalled();
    expect(screen.getByText('₹299.00')).toBeInTheDocument();
  });

  it('a half-typed edit does not follow the librarian to the next book', async () => {
    // The detail panel is fixed-position, not modal, so clicking another row in
    // the table behind it is the normal way to move between books — and it only
    // calls setSelected. Without `key={selected.id}` on the caller side, this
    // component is reused rather than remounted, `draft` survives, and Save
    // writes book A's half-typed amount onto book B.
    //
    // The caller's `key` is what fixes it, so this test asserts the CONTRACT
    // the key provides: a fresh instance for a different title starts clean.
    // `rerender` with a different key is exactly what React does on that click.
    const { rerender } = render(
      <ReplacementPrice key="a" title={titleWith(null)} onSaved={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set a price' }));
    fireEvent.change(screen.getByRole('textbox', { name: /cost to replace/i }), {
      target: { value: '299' },
    });

    const bookB = { ...titleWith('1200'), id: 't2', title: 'India After Gandhi' };
    rerender(<ReplacementPrice key="b" title={bookB} onSaved={() => {}} />);

    // Book B shows ITS price, read-only — not book A's abandoned draft.
    expect(screen.getByText('₹1200.00')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('prefills the input with the current price when editing', async () => {
    render(<ReplacementPrice title={titleWith('299')} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('textbox', { name: /cost to replace/i })).toHaveValue('299');
  });

  it('labels the input for a screen reader — the ₹ sign is decorative', async () => {
    render(<ReplacementPrice title={titleWith(null)} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set a price' }));
    expect(screen.getByLabelText('Cost to replace, in rupees')).toBeInTheDocument();
  });
});
