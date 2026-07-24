'use client';

import { useState } from 'react';

/**
 * Tiny interactive quiz block — ported from the approved drafts
 * (drafts-review.html): options render as buttons, the first click locks the
 * quiz, marks the clicked option correct/wrong, always reveals the correct
 * option, and shows the "why". No dependencies.
 */
export default function BlogQuiz({
  tag,
  q,
  options,
  correct,
  why,
}: {
  tag?: string;
  q: string;
  options: string[];
  correct: number;
  why: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;

  return (
    <div className={`blog-quiz${done ? ' blog-quiz-done' : ''}`}>
      {tag && <span className="blog-quiz-tag">{tag}</span>}
      <div className="blog-quiz-q">{q}</div>
      <div className="blog-quiz-opts">
        {options.map((opt, i) => {
          const cls =
            done && i === correct
              ? 'blog-quiz-opt blog-quiz-opt-correct'
              : done && i === picked
                ? 'blog-quiz-opt blog-quiz-opt-wrong'
                : 'blog-quiz-opt';
          return (
            <button
              key={i}
              type="button"
              className={cls}
              onClick={() => !done && setPicked(i)}
              aria-pressed={picked === i}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {done && (
        <div className="blog-quiz-why">
          <strong>Why: </strong>
          {why}
        </div>
      )}
    </div>
  );
}
