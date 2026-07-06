'use client';

import type { PublicCourse, PublicSiteData } from '@/lib/public-api';

type Admissions = PublicSiteData['admissions'];

export function admissionsHasContent(admissions: Admissions, courses: PublicCourse[]): boolean {
  return admissions.steps.length > 0 || (admissions.showFees && courses.some((c) => c.fee));
}

/** Admission process steps + optional fee table (one row per course with a fee). */
export default function AdmissionsSection({
  admissions,
  courses,
}: {
  admissions: Admissions;
  courses: PublicCourse[];
}) {
  if (!admissionsHasContent(admissions, courses)) return null;
  const feeRows = admissions.showFees ? courses.filter((c) => c.fee) : [];

  return (
    <section id="admissions" className="max-w-6xl mx-auto px-6 py-20">
      <div className="reveal">
        <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
          Admissions
        </div>
        <h2 className="ps-head text-4xl font-bold mt-3">Joining us is simple</h2>
      </div>

      {admissions.steps.length > 0 && (
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {admissions.steps.map((s, i) => (
            <div
              key={i}
              className="reveal ps-lift ps-card ps-soft rounded-3xl p-5"
              style={{ transitionDelay: `${i * 0.06}s` }}
            >
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
