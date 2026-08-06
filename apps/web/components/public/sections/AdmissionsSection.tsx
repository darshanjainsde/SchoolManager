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
/** A requested page must never answer with silence. See /academics, /gallery. */
function AdmissionsEmpty() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-6">
      <div className="ps-panel p-12 text-center">
        <svg viewBox="0 0 120 84" className="mx-auto h-24 w-32" fill="none" aria-hidden="true">
          <path
            d="M30 12h44l16 16v44a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6z"
            stroke="var(--ps1)"
            strokeWidth="2.5"
            opacity=".35"
          />
          <path d="M74 12v16h16" stroke="var(--ps1)" strokeWidth="2.5" opacity=".45" />
          <path d="M38 44h40M38 56h28" stroke="var(--ps1)" strokeWidth="2.5" strokeLinecap="round" opacity=".3" />
          <circle cx="84" cy="62" r="10" fill="var(--ps2)" opacity=".18" />
        </svg>
        <h3 className="ps-head font-bold text-lg mt-5">Admissions details are on the way</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
          The steps to apply — and the fees, if the school publishes them — appear here once they are added.
        </p>
      </div>
    </section>
  );
}

export default function AdmissionsSection({
  admissions,
  courses,
  variant = 'journey',
  showFeeTable = false,
  onOwnPage,
}: {
  admissions: Admissions;
  courses: PublicCourse[];
  variant?: 'journey' | 'rail';
  /**
   * FEES LIVE ON /admissions AND NOWHERE ELSE.
   *
   * This section is rendered twice — as a band on the home page and as the
   * whole of the admissions page — and the fee table used to come with it in
   * both places. So a school that filled in its fees found them published
   * halfway down its front page, next to the photographs.
   *
   * Fees are the most consequential figures on a school's site: they are what
   * a family screenshots, what a competitor reads, and what an admissions
   * office wants read IN CONTEXT, under the process and the note that explains
   * what the number includes. The home page has none of that context.
   *
   * Defaulting to `false` is the point — the fee table cannot appear anywhere
   * new by accident, because every caller has to ask for it explicitly, and
   * only one does.
   */
  showFeeTable?: boolean;
  /** True when this section IS /admissions — a requested page, never silent. */
  onOwnPage?: boolean;
}) {
  if (!admissionsHasContent(admissions, courses)) {
    if (!onOwnPage) return null;
    return <AdmissionsEmpty />;
  }
  const feeRows = showFeeTable && admissions.showFees ? courses.filter((c) => c.fee) : [];
  const steps = admissions.steps;
  // A school whose only admissions content is its fees now has NOTHING to put
  // on the home page — `admissionsHasContent` counts fees, but this render no
  // longer shows them. Without this guard that school gets an empty headed
  // band on its front page, which is a worse bug than the one being fixed.
  if (steps.length === 0 && feeRows.length === 0) {
    // A BAND with nothing in it should not appear between bands that do. A PAGE
    // the visitor asked for by name must never answer with silence — the same
    // rule /academics and /gallery follow.
    if (!onOwnPage) return null;
    return <AdmissionsEmpty />;
  }

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
                  className="ps-jbody ps-panel p-5"
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
              className={`ps-rstep ${i % 2 ? 'ps-rstep-r' : 'ps-rstep-l'} ps-panel p-5 my-5`}
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
        <div className="reveal mt-10 ps-panel overflow-hidden">
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
