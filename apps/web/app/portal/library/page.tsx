'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { MyBooks } from '@/components/library/my-books';
import { rupees, shelfLabel, type MyLibrary, type ShelfResult } from '@/lib/library';

/**
 * The library, for a child.
 *
 * ONE screen, not four. The approved prototype had My books / Find / Fines /
 * Alerts as separate tabs; they collapse here because a 6-tab bar is already at
 * phone width, and a permanent "Fines" tab in a product where fines are OFF by
 * default is an empty room a child walks into forever.
 *
 * Order is deliberate: what do I have -> is the book I want on the shelf ->
 * what do I owe, and only if I owe something. Alerts get no tab at all; they go
 * to the Announcements tab the student already reads.
 *
 * There is no "I lost this book" control here YET. Self-report exists in the
 * API and shows the child no rupee figure by design, but the screen it belongs
 * on is the one where a librarian can see the report — that arrives with the
 * console. Shipping the button before the librarian can act on it would leave
 * children reporting losses into a void.
 */
export default function StudentLibraryPage(): React.JSX.Element {
  const api = useApi();
  const [term, setTerm] = useState('');

  const mine = useQuery({
    queryKey: ['library', 'mine'],
    queryFn: () => api.get<MyLibrary>('/me/library'),
  });

  const shelf = useQuery({
    queryKey: ['library', 'shelf', term],
    // Two characters is the API's own floor; asking earlier returns [] anyway
    // and just costs a request per keystroke.
    enabled: term.trim().length >= 2,
    queryFn: () => api.get<ShelfResult[]>(`/me/library/shelf?q=${encodeURIComponent(term.trim())}`),
  });

  if (mine.isPending) return <p className="sk-lib-empty">Loading…</p>;

  // Not a member of the library at all. Not an error, and deliberately not
  // phrased as one — plenty of schools enrol class by class, so a child can
  // legitimately be here before their turn.
  if (mine.data && !mine.data.isMember) {
    return (
      <section className="sk-lib">
        <h1>Library</h1>
        <p className="sk-lib-empty">
          You are not signed up at the library yet. Ask your class teacher.
        </p>
      </section>
    );
  }

  const owed = mine.data?.owed;

  return (
    <section className="sk-lib">
      <h1>Library</h1>

      <h2 className="sk-lib-h2">My books</h2>
      <MyBooks books={mine.data?.books ?? []} />

      <h2 className="sk-lib-h2">Find a book</h2>
      <input
        className="sk-lib-search"
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Type part of the name"
        aria-label="Search the library"
      />
      {shelf.data && shelf.data.length > 0 ? (
        <ul className="sk-lib-shelf">
          {shelf.data.map((r) => (
            <li key={r.titleId} className="sk-lib-shelf-row">
              <span className="sk-lib-title">{r.title}</span>
              {r.author ? <span className="sk-lib-author">{r.author}</span> : null}
              <span
                className="sk-lib-avail"
                data-out={r.availableCopies === 0 ? 'true' : 'false'}
              >
                {shelfLabel(r.availableCopies, r.totalCopies)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {shelf.isFetched && term.trim().length >= 2 && shelf.data?.length === 0 ? (
        <p className="sk-lib-empty">No book by that name.</p>
      ) : null}

      {/* ABSENT, not zero. A permanent "₹0 owed" line teaches a family to expect
          a charge from a library that mostly charges nothing. */}
      {owed !== undefined && owed > 0 ? (
        <>
          <h2 className="sk-lib-h2">What I owe</h2>
          <p className="sk-lib-owed">{rupees(owed)}</p>
          <p className="sk-lib-owed-note">Pay at the library desk.</p>
        </>
      ) : null}
    </section>
  );
}
