'use client';

import { useState } from 'react';
import type { PublicCourse } from '@/lib/public-api';
import { submitEnquiry, type EnquiryResult } from '../enquiry-client';
import ProgrammeMark from '../ProgrammeMark';

/** Homepage strip: featured courses as 3D flip cards with a phone capture on the back. */
export default function CoursesFeatured({ courses }: { courses: PublicCourse[] }) {
  const featured = courses.filter((c) => c.featured);
  if (featured.length === 0) return null;

  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <div className="reveal">
        <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
          Programmes
        </div>
        <h2 className="ps-head text-4xl font-bold mt-3">Learning for every stage</h2>
        <p className="mt-2 text-slate-600 max-w-xl">
          Tap a programme to see what&rsquo;s inside — or leave a number and admissions will call you back.
        </p>
      </div>
      {/* ps-courses-grid is the stable hook the layout variants restyle. */}
      <div className="ps-courses-grid mt-10 grid md:grid-cols-3 gap-6">
        {featured.map((c, i) => (
          <FlipCard key={c.id} course={c} delay={i * 0.07} />
        ))}
      </div>
    </section>
  );
}

function FlipCard({ course, delay }: { course: PublicCourse; delay: number }) {
  const [flipped, setFlipped] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | EnquiryResult>('idle');
  const [phone, setPhone] = useState('');

  async function requestCall() {
    const p = phone.trim();
    if (!p || status === 'sending') return;
    setStatus('sending');
    // The enquiry API requires a parent name; card leads capture phone only,
    // so a fixed marker labels them in the admin's enquiry inbox.
    const result = await submitEnquiry({
      parentName: 'Course card lead',
      phone: p,
      gradeInterest: course.name,
      message: `Requested a call back about ${course.name} from the homepage.`,
    });
    setStatus(result);
  }

  return (
    // The scroll-reveal observer adds 'in' to `.reveal` elements imperatively;
    // React wipes foreign classes whenever it rewrites a CHANGED className.
    // So `reveal` must sit on this wrapper (className never changes) and the
    // state-driven flip classes on the child — never both on one element.
    <div className="reveal" style={{ transitionDelay: `${delay}s` }}>
    <div
      className={`ps-flip ${flipped ? 'ps-flipped' : ''}`}
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={flipped}
      aria-label={`${course.name} — ${flipped ? 'hide' : 'show'} details`}
    >
      <div className="ps-flip-inner">
        {/* front */}
        <div className="ps-face ps-card ps-soft">
          {course.imageUrl ? (
            <div className="h-40 bg-cover bg-center" style={{ backgroundImage: `url('${course.imageUrl}')` }} />
          ) : (
            <ProgrammeMark name={course.name} className="h-40" />
          )}
          <div className="p-5 flex flex-col gap-1.5 flex-1">
            {course.ageRange && (
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ps1)' }}>
                {course.ageRange}
              </span>
            )}
            <h3 className="ps-head text-xl font-bold">{course.name}</h3>
            {course.tagline && <p className="text-sm text-slate-500 flex-1">{course.tagline}</p>}
            <span className="text-sm font-semibold mt-1" style={{ color: 'var(--ps1)' }}>
              See details ↻
            </span>
          </div>
        </div>
        {/* back */}
        <div className="ps-face ps-face-back p-5 text-white">
          <h3 className="ps-head text-lg font-bold text-white">{course.name}</h3>
          {course.ageRange && <div className="text-xs text-white/75 mt-0.5">{course.ageRange}</div>}
          {status === 'ok' ? (
            <div className="flex-1 grid place-items-center text-center text-sm px-2">
              ✅ Thanks! Admissions will call you about {course.name}.
            </div>
          ) : (
            <>
              {course.highlights.length > 0 ? (
                <ul className="mt-3 space-y-1.5 text-[13px] flex-1 overflow-hidden">
                  {course.highlights.slice(0, 4).map((h, i) => (
                    <li key={i} className="pl-5 relative">
                      <span className="absolute left-0 font-bold" style={{ color: 'var(--ps2)' }}>✓</span>
                      {h}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[13px] text-white/85 flex-1 overflow-hidden">{course.description ?? course.tagline}</p>
              )}
              <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && requestCall()}
                  placeholder="Your phone number"
                  aria-label={`Phone number for ${course.name} enquiry`}
                  className="flex-1 min-w-0 rounded-lg px-3 py-2 text-[13px] bg-white/15 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40"
                />
                <button
                  onClick={requestCall}
                  disabled={status === 'sending'}
                  className="ps-accentbg rounded-lg px-3 text-[12px] font-bold disabled:opacity-60"
                  style={{ color: 'var(--ink)' }}
                >
                  {status === 'sending' ? '…' : 'Request a call'}
                </button>
              </div>
              <div className="text-[10.5px] text-white/60 mt-2">
                {status === 'rate'
                  ? 'A few requests already — please try again shortly.'
                  : status === 'error'
                    ? 'Something went wrong — please try again.'
                    : 'We only use this to call you back.'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
