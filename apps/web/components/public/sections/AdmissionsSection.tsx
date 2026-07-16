'use client';

import type { PublicCourse, PublicSiteData } from '@/lib/public-api';
import { admissionsHasContent } from '../site-utils';

type Admissions = PublicSiteData['admissions'];

export { admissionsHasContent };

/**
 * Admission process steps + optional fee table (one row per course with a fee).
 * `journey` (homepage): dashed path draws itself, numbered badges spring onto
 * it, cards land staggered. `rail` (/admissions page): vertical brand-gradient
 * rail fills while alternating steps arrive. Both are static under
 * reduced-motion / Animation=Off (see PS_CSS).
 */
export default function AdmissionsSection({
  admissions,
  courses,
  variant = 'journey',
}: {
  admissions: Admissions;
  courses: PublicCourse[];
  variant?: 'journey' | 'rail';
}) {
  if (!admissionsHasContent(admissions, courses)) return null;
  const feeRows = admissions.showFees ? courses.filter((c) => c.fee) : [];
  const steps = admissions.steps;
  // The connector path only reads as one line when every step sits in one row.
  const journeyCols =
    steps.length >= 4 ? 'lg:grid-cols-4' : steps.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2';

  return (
    <section id="admissions" className="max-w-6xl mx-auto px-6 py-20">
      <div className="reveal">
        <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
          Admissions
        </div>
        <h2 className="ps-head text-4xl font-bold mt-3">Joining us is simple</h2>
      </div>

      {steps.length > 0 && variant === 'journey' && (
        <div className="reveal ps-journey mt-10">
          {steps.length > 1 && (
            <div className="ps-jline hidden lg:block" aria-hidden="true">
              <div className="ps-jline-mask">
                <svg className="w-full h-full" viewBox="0 0 600 30" preserveAspectRatio="none" fill="none">
                  <path
                    d="M4 20 C 120 4, 220 28, 300 15 S 500 6, 596 18"
                    stroke="var(--ps2)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="7 8"
                  />
                </svg>
              </div>
            </div>
          )}
          <div className={`relative grid sm:grid-cols-2 ${journeyCols} gap-4`}>
            {steps.map((s, i) => (
              <div key={i}>
                <span
                  className="ps-jbadge text-[11px]"
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--ps2)',
                    transitionDelay: `${0.45 + i * 0.28}s`,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div
                  className="ps-jbody ps-card ps-soft rounded-3xl p-5"
                  style={{ transitionDelay: `${0.55 + i * 0.28}s` }}
                >
                  <h3 className="ps-head font-bold">{s.title}</h3>
                  {s.description && <p className="text-[13px] text-slate-500 mt-1">{s.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {steps.length > 0 && variant === 'rail' && (
        <div className="reveal ps-rail mt-10 max-w-3xl mx-auto">
          <div className="ps-rail-line" aria-hidden="true" />
          <div className="ps-rail-fill" aria-hidden="true" />
          {steps.map((s, i) => (
            <div
              key={i}
              className={`ps-rstep ${i % 2 ? 'ps-rstep-r' : 'ps-rstep-l'} ps-card ps-soft rounded-2xl p-5 my-5`}
              style={{ transitionDelay: `${0.3 + i * 0.3}s` }}
            >
              <span className="ps-rdot" aria-hidden="true" />
              <span
                className="inline-block text-[11px] font-extrabold tracking-widest rounded-full px-2.5 py-1"
                style={{ background: 'var(--ink)', color: 'var(--ps2)' }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="ps-head font-bold mt-3">{s.title}</h3>
              {s.description && <p className="text-[13px] text-slate-500 mt-1">{s.description}</p>}
            </div>
          ))}
        </div>
      )}

      {feeRows.length > 0 && (
        <div className="reveal mt-10 ps-card ps-soft rounded-3xl overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-black/5">
            <h3 className="ps-head font-bold text-lg">Fee structure</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[540px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400" style={{ background: 'color-mix(in srgb, var(--ps1) 5%, #fff)' }}>
                  <th className="px-6 py-2.5 font-semibold">Programme</th>
                  <th className="px-6 py-2.5 font-semibold">Admission fee</th>
                  <th className="px-6 py-2.5 font-semibold">Annual tuition</th>
                  <th className="px-6 py-2.5 font-semibold">Includes</th>
                </tr>
              </thead>
              <tbody>
                {feeRows.map((c) => (
                  <tr key={c.id} className="border-t border-black/[.04] text-slate-600">
                    <td className="px-6 py-3 font-semibold" style={{ color: 'var(--ink)' }}>{c.name}</td>
                    <td className="px-6 py-3 font-semibold tabular-nums">{c.fee!.admissionFee ?? '—'}</td>
                    <td className="px-6 py-3 font-semibold tabular-nums">{c.fee!.annualFee ?? '—'}</td>
                    <td className="px-6 py-3">{c.fee!.includes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {admissions.feeNote && (
            <div className="px-6 py-3 text-xs text-slate-500" style={{ background: 'color-mix(in srgb, var(--ps2) 8%, #fff)' }}>
              {admissions.feeNote}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
