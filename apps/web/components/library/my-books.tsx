'use client';

import type { MyBook } from '@/lib/library';
import { backByLabel, stateLabel, toneFor } from '@/lib/library';

/**
 * The borrowed-books list, shared by the student and teacher screens.
 *
 * ONE component on purpose. The borrowing RULES differ — 14 days and 2 books
 * for a student, 30 and 5 for a teacher, driven by `CirculationPolicy` per
 * member type — but the experience of "what do I have and when must it go back"
 * is identical. Two components would drift, and the drift would show up as two
 * different answers to the same question inside one product.
 */
export function MyBooks({ books }: { books: MyBook[] }): React.JSX.Element {
  if (books.length === 0) {
    return (
      <p className="sk-lib-empty">
        Nothing borrowed right now.
      </p>
    );
  }

  return (
    <ul className="sk-lib-books">
      {books.map((b) => {
        const tone = toneFor(b.daysLeft);
        return (
          <li key={b.issueId} className="sk-lib-book" data-tone={tone}>
            <div className="sk-lib-book-main">
              <span className="sk-lib-title">{b.title}</span>
              {/* "Book number", never "accession number" — that word survives
                  only in the register, which is the auditor's document. */}
              <span className="sk-lib-no">no. {b.accessionNumber}</span>
            </div>
            <div className="sk-lib-book-when">
              <span className="sk-lib-backby">{backByLabel(b.backBy)}</span>
              <span className="sk-lib-state" data-tone={tone}>
                {stateLabel(b.daysLeft)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
