'use client';

import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { MyBooks } from '@/components/library/my-books';
import type { ClassNotReturned, MyLibrary } from '@/lib/library';

/**
 * The library, for a teacher.
 *
 * Two blocks, and they are different in kind.
 *
 * The top is the SAME component the student sees, deliberately. A teacher's
 * borrowing rules are longer — 30 days and 5 books against 14 and 2 — but that
 * lives in `CirculationPolicy`, not in the UI, and the experience of "what do I
 * have, when does it go back" is identical.
 *
 * The bottom is the only mechanism in the entire product that actually recovers
 * a book from a ten-year-old. The librarian has no authority over a child; the
 * class teacher does. So it must stay a NUDGE LIST — names and titles, never
 * amounts, even when fines are switched on. The moment a staffroom screen shows
 * what children owe, this becomes fee collection and the teacher stops opening
 * it, and then nothing recovers the books at all.
 *
 * There are no issue/return controls. A teacher borrows; they do not run the
 * counter. Confirmed explicitly rather than assumed — giving a teacher the
 * ability to lend to any child is a much larger authorisation change than a
 * menu item.
 */
export default function TeacherLibraryPage(): React.JSX.Element {
  // The tenant host is required. useApi() with no arguments sends no
  // X-Skoolos-Host, so the API cannot resolve which school is asking and every
  // request from this screen fails — while the same URL succeeds from anything
  // that does send it. Same defect as the librarian counter, found by the guard
  // in app/tenant-host.test.ts once it was written.
  const host = useHost();
  const api = useApi({ audience: "school", hostHeader: host });

  const mine = useQuery({
    queryKey: ['library', 'mine'],
    queryFn: () => api.get<MyLibrary>('/me/library'),
  });

  // The teacher's own class, resolved server-side from their profile. A class
  // parameter chosen by the client would let any teacher read any class's
  // not-returned list.
  const notReturned = useQuery({
    queryKey: ['library', 'class-not-returned'],
    queryFn: () => api.get<ClassNotReturned[]>('/me/library/class'),
  });

  if (mine.isPending) return <p className="sk-lib-empty">Loading…</p>;

  if (mine.data && !mine.data.isMember) {
    return (
      <section className="sk-lib">
        <h1>Library</h1>
        <p className="sk-lib-empty">You are not signed up at the library yet.</p>
      </section>
    );
  }

  const rows = notReturned.data ?? [];

  return (
    <section className="sk-lib">
      <h1>Library</h1>

      <h2 className="sk-lib-h2">My books</h2>
      <MyBooks books={mine.data?.books ?? []} />

      {rows.length > 0 ? (
        <>
          <h2 className="sk-lib-h2">
            {rows.length === 1 ? '1 book not returned' : `${rows.length} books not returned`}
          </h2>
          <ul className="sk-lib-class">
            {rows.map((r, i) => (
              <li key={`${r.name}-${r.title}-${i}`} className="sk-lib-class-row">
                <span className="sk-lib-child">{r.name}</span>
                <span className="sk-lib-title">{r.title}</span>
                {/* Days, never rupees. See the block comment above. */}
                <span className="sk-lib-state" data-tone="late">
                  {r.daysLate === 1 ? '1 day late' : `${r.daysLate} days late`}
                </span>
              </li>
            ))}
          </ul>
          <p className="sk-lib-nudge">
            A word from you is what brings these back.
          </p>
        </>
      ) : null}
    </section>
  );
}
