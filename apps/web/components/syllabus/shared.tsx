'use client';
import { ApiError } from '@/lib/api';
import type { SyllabusTrackSummary } from '@skoolos/types';
import { PaceRings, RingLegend, TAUGHT_COLOR, EXPECTED_COLOR } from './rings';
import { PACE_LABEL, PACE_TONE } from './labels';

/** The designed refusal: the feature is in no tier, the owner switches it on. */
export function NotInPlan() {
  return (
    <p className="mx-auto max-w-md py-12 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }} data-testid="syl-not-in-plan">
      The syllabus tracker isn&rsquo;t part of your school&rsquo;s plan yet.
    </p>
  );
}

export const isPlanRefusal = (e: unknown) => e instanceof ApiError && e.status === 403;

/** The hero of a track or of the whole school: rings, the legend, the verdict. */
export function TrackHero({ t, title, line, children }: { t: Pick<SyllabusTrackSummary, 'pct' | 'expectedPct' | 'pace' | 'leaves' | 'done' | 'now'>; title: string; line?: string; children?: React.ReactNode }) {
  return (
    <div className="sk-syl-hero" data-testid="syl-hero">
      <PaceRings pct={t.pct} expectedPct={t.expectedPct} size={112} stroke={11} />
      <RingLegend outer={{ pct: t.pct, color: TAUGHT_COLOR, label: 'Taught' }} inner={{ pct: t.expectedPct, color: EXPECTED_COLOR, label: 'Expected by today' }} />
      <div className="txt">
        <h2>{title}</h2>
        <p>
          <span className="sk-pill" data-tone={PACE_TONE[t.pace]}>{PACE_LABEL[t.pace]}</span>
          {line ? <> &nbsp;{line}</> : null}
        </p>
        {t.now && <p>Now: <b>{t.now.title}</b></p>}
        {!t.now && t.leaves > 0 && <p>Every chapter is done.</p>}
        {children}
      </div>
    </div>
  );
}
