'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
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
 * "I have lost a book" IS here now. It was held back deliberately until a
 * librarian had a screen showing the report — the counter — because a child
 * owning up into a void is worse than not owning up at all. It shows no rupee
 * figure, by design and by API: reporting creates no `Fine`, and the amount is
 * decided later by a librarian looking at the actual book. What the child is
 * told is that the clock has stopped, which is the whole reason owning up is
 * safe for them.
 *
 * Two steps — pick the book, then confirm. This closes a real loan and moves a
 * real book to LOST; one tap from a nine-year-old scrolling a list is not
 * enough intent for that.
 */
export default function StudentLibraryPage(): React.JSX.Element {
  // The tenant host is required. useApi() with no arguments sends no
  // X-Skoolos-Host, so the API cannot resolve which school is asking and every
  // request from this screen fails — while the same URL succeeds from anything
  // that does send it. Same defect as the librarian counter, found by the guard
  // in app/tenant-host.test.ts once it was written.
  const host = useHost();
  const api = useApi({ audience: "school", hostHeader: host });
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');

  // Two steps on purpose: choosing a book from the list, then confirming it.
  // "I have lost it" closes the loan and moves a real book to LOST — one tap
  // from a nine-year-old scrolling a list is not enough intent for that.
  const [lostFor, setLostFor] = useState<{ accessionNumber: string; title: string } | null>(null);
  const [lostDone, setLostDone] = useState<string | null>(null);

  const reportLost = useMutation({
    mutationFn: (accessionNumber: string) =>
      api.post<{ lostReportId: string; lateChargeFrozen: boolean }>('/me/library/lost', {
        accessionNumber,
      }),
    onSuccess: () => {
      setLostFor(null);
      // No amount, and no apology. The clock stopping is the honest, useful
      // thing to say, and `lateChargeFrozen` is deliberately NOT turned into a
      // rupee figure here — the API does not send one.
      setLostDone('Thank you for telling us. The library will let you know what happens next.');
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: () => setLostDone('That did not save. Nothing has been changed.'),
  });

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

      {/* Owning up. The button was held back until a librarian had a screen to
          see the report on — reporting into a void is worse than not reporting.
          It says nothing about money because nothing about money has happened:
          no Fine is created, and the amount is decided later by a librarian
          looking at the actual book. What the child is told is that the clock
          has stopped, which is the entire reason owning up is safe. */}
      {(mine.data?.books.length ?? 0) > 0 ? (
        <div className="sk-lib-lost">
          {lostFor ? (
            <>
              <p className="sk-lib-nudge">
                Tell the library you have lost <strong>{lostFor.title}</strong>?
              </p>
              <div className="sk-desk-actions">
                <button
                  className="sk-btn"
                  data-variant="primary"
                  disabled={reportLost.isPending}
                  onClick={() => reportLost.mutate(lostFor.accessionNumber)}
                >
                  {reportLost.isPending ? 'Telling them…' : 'Yes, I have lost it'}
                </button>
                <button className="sk-btn" onClick={() => setLostFor(null)}>
                  No, keep looking
                </button>
              </div>
            </>
          ) : (
            <select
              className="sk-lib-search"
              value=""
              aria-label="Tell the library you have lost a book"
              onChange={(e) => {
                const book = mine.data?.books.find((b) => b.issueId === e.target.value);
                setLostFor(book ? { accessionNumber: book.accessionNumber, title: book.title } : null);
                setLostDone(null);
              }}
            >
              <option value="">I have lost a book…</option>
              {(mine.data?.books ?? []).map((b) => (
                <option key={b.issueId} value={b.issueId}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
          {lostDone ? <p className="sk-lib-nudge">{lostDone}</p> : null}
        </div>
      ) : null}

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
