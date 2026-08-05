'use client';

import type { PublicCourse } from '@/lib/public-api';

const COURSE_EMOJIS = ['🧸', '📚', '🔬', '🎓', '🎨', '🏆', '🌟', '💡'];

/** Full catalogue — every course, featured or not. Nav dropdown items land here. */
/**
 * `onOwnPage` — this section is the WHOLE page, not a band on the home page.
 *
 * Each of these sections carries its own eyebrow and heading, which is correct
 * on the home page where it has to introduce itself between other bands. On its
 * own page it is wrong twice over: PublicSite already renders a page header, so
 * the eyebrow appeared TWICE and two headings competed — one left-aligned, one
 * centred, saying nearly the same thing. It is the same bug class as the fee
 * table: a section that does not know which context it is in.
 */
export default function AcademicsSection({
  courses,
  onOwnPage = false,
}: {
  courses: PublicCourse[];
  onOwnPage?: boolean;
}) {
  if (courses.length === 0) return null;

  return (
    <section id="academics" className="bg-white border-t border-black/5">
      <div className={onOwnPage ? 'max-w-6xl mx-auto px-6 pt-10 pb-20' : 'max-w-6xl mx-auto px-6 py-20'}>
        {!onOwnPage && (
          <div className="reveal text-center max-w-2xl mx-auto">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
              Academics
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">
              <span className="ps-accent-mark">Programmes for every stage</span>
            </h2>
          </div>
        )}
        <div className={onOwnPage ? 'grid gap-5' : 'mt-12 grid gap-5'}>
          {courses.map((c, i) => (
            <div
              key={c.id}
              id={`course-${c.id}`}
              className="reveal ps-lift grid md:grid-cols-[220px,1fr] overflow-hidden ps-panel scroll-mt-24"
              style={{ transitionDelay: `${i * 0.05}s`, background: 'var(--paper)' }}
            >
              {c.imageUrl ? (
                <div className="min-h-[150px] bg-cover bg-center" style={{ backgroundImage: `url('${c.imageUrl}')` }} />
              ) : (
                <div className="min-h-[150px] ps-brandgrad grid place-items-center text-5xl text-white">
                  {COURSE_EMOJIS[i % COURSE_EMOJIS.length]}
                </div>
              )}
              <div className="p-6 flex flex-col gap-2">
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                  {c.ageRange && <span className="ps-chip rounded-full px-2.5 py-1">{c.ageRange}</span>}
                </div>
                <h3 className="ps-head text-xl font-bold">{c.name}</h3>
                {(c.description || c.tagline) && (
                  <p className="text-sm text-slate-600 whitespace-pre-line">{c.description ?? c.tagline}</p>
                )}
                {c.highlights.length > 0 && (
                  <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-500 mt-1">
                    {c.highlights.map((h, j) => (
                      <li key={j}>
                        <span className="font-bold" style={{ color: 'var(--ps1)' }}>✓</span> {h}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
