'use client';

import { useState } from 'react';
import { readSession } from '@/lib/session';
import { setReplacementPrice, type TitleHit } from '@/lib/catalogue';
import { formatRupees, type Money } from '@/lib/circulation';
import { ApiError } from '@/lib/api';

/** Stable id so the input's aria-describedby can point at the error text. Only
 *  one of these renders at a time — the detail panel shows a single title. */
const ERROR_ID = 'replacement-price-error';

/**
 * The one place a librarian sets what a lost copy of this book costs to
 * replace.
 *
 * Deliberately an inline field in the existing detail panel rather than a title
 * edit form: `PATCH /catalog/titles/:id` already exists and already carries
 * scalars, while a real edit form drags in author and category relinking, which
 * that endpoint explicitly excludes. Without a surface here the column would be
 * unreachable from the product and every lost book would take the "no price on
 * record" branch forever.
 *
 * "Not set" is rendered as words rather than as an empty box, because unpriced
 * is a designed state that the product says out loud — an empty input reads as
 * "loading" or as zero, and zero means something else entirely here (a book
 * written off at ₹0).
 */
export function ReplacementPrice({
  title,
  onSaved,
}: {
  title: TitleHit;
  onSaved: (price: Money | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = title.replacementPrice;
  const isSet = current !== null && current !== undefined;

  function beginEdit() {
    setDraft(isSet ? String(current) : '');
    setError(null);
    setNote(null);
    setEditing(true);
  }

  async function save(next: number | null) {
    const session = readSession();
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await setReplacementPrice(session.host, session.accessToken, title.id, next);
      onSaved(updated.replacementPrice ?? null);
      setEditing(false);
      setNote(next === null ? 'Cost to replace cleared.' : 'Cost to replace saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Takes the raw value explicitly rather than reading `draft` from state: the
   * Clear button would otherwise have to `setDraft('')` and then call this in
   * the same tick, where `draft` is still the OLD value — React has not
   * re-rendered yet — and clearing would silently re-save the existing price.
   */
  function submit(raw: string = draft) {
    const trimmed = raw.trim();

    // An emptied box CLEARS the price. Confirmed rather than blocked: clearing
    // is rare and consequential, but refusing it would leave a librarian who
    // typed the wrong number able only to replace it with another guess.
    if (trimmed === '') {
      // Nothing to clear on a book that has no price — asking "clear the
      // replacement price?" about a price that does not exist is a confusing
      // prompt for what is really an empty submit. Just close the editor.
      if (!isSet) {
        setEditing(false);
        return;
      }
      const ok = window.confirm(
        `Clear the replacement price for “${title.title}”? Losses will show no suggested amount until a price is set again.`,
      );
      if (ok) void save(null);
      return;
    }

    const n = Number(trimmed);
    // Mirrors the API's own bounds so the common mistake is caught next to the
    // input rather than as a 400 from a round trip. The API still validates —
    // this is a courtesy, never the control.
    if (!Number.isFinite(n) || n < 0 || n > 100_000 || (trimmed.split('.')[1]?.length ?? 0) > 2) {
      setError('Enter an amount between 0 and 100000, with at most two decimal places.');
      return;
    }
    void save(n);
  }

  if (!editing) {
    return (
      <>
        {isSet ? (
          <span className="lbx-mono">{formatRupees(current)}</span>
        ) : (
          <span style={{ color: 'var(--lb-ink-3)' }}>Not set</span>
        )}{' '}
        <button
          type="button"
          className="lbx-btn ghost"
          style={{ padding: '.1rem .4rem', fontSize: '.76rem' }}
          onClick={beginEdit}
        >
          {isSet ? 'Change' : 'Set a price'}
        </button>
        <div style={{ fontSize: '.74rem', color: 'var(--lb-ink-3)', marginTop: '.15rem' }}>
          What it would cost to buy this book again today. Used when a book is lost.
        </div>
        {!isSet ? (
          <div style={{ fontSize: '.74rem', color: 'var(--lb-ink-3)' }}>
            Without this, a lost book has no suggested amount and the librarian types one at the
            counter.
          </div>
        ) : null}
        {note ? (
          <div role="status" style={{ fontSize: '.74rem', color: 'var(--lb-ink-2)' }}>
            {note}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <span style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
        <span aria-hidden="true">₹</span>
        <input
          aria-label="Cost to replace, in rupees"
          // Tie the error to the field it is about. Without these, a screen
          // reader hears the alert once and, on tabbing back, gets no signal
          // that this is the control that was rejected.
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ERROR_ID : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="299"
          inputMode="decimal"
          autoFocus
          disabled={busy}
          style={{ width: '6rem' }}
        />
        {/* Wrapped, not passed bare: `onClick={submit}` hands the MouseEvent
            to `raw`, which then stringifies to "[object MouseEvent]" and every
            save fails validation. */}
        <button type="button" className="lbx-btn" disabled={busy} onClick={() => submit()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {isSet ? (
          <button
            type="button"
            className="lbx-btn ghost"
            disabled={busy}
            onClick={() => submit('')}
          >
            Clear
          </button>
        ) : null}
        <button type="button" className="lbx-btn ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
      <div style={{ fontSize: '.74rem', color: 'var(--lb-ink-3)', marginTop: '.15rem' }}>
        What it would cost to buy this book again today. Used when a book is lost.
      </div>
      {error ? (
        <div id={ERROR_ID} role="alert" style={{ fontSize: '.74rem', color: 'var(--lb-bad, #8a3733)' }}>
          {error}
        </div>
      ) : null}
    </>
  );
}
