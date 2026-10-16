'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { SyllabusOverview, SyllabusPace, SyllabusTrack, SyllabusTrackSummary } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { HubPage } from '@/components/ui/hub';
import { Cell, Figure, Figures, Overlay, Row, RowList, RowTitle, ScrollBox } from '@/components/ui/kit';
import { QueryError } from '@/components/ui/query-state';
import { ChapterList } from '@/components/syllabus/chapter-list';
import { PACE_LABEL, PACE_TONE, gapLine, sinceLine, worstFirst } from '@/components/syllabus/labels';
import { EXPECTED_COLOR, PaceRings, TAUGHT_COLOR } from '@/components/syllabus/rings';
import { NotInPlan, TrackHero, isPlanRefusal } from '@/components/syllabus/shared';

/**
 * THE SYLLABUS, the office's side: every section of the year against the
 * year. Dropdowns, not chips — a school has 30 sections and 10 subjects.
 * Worst first, because the only question the office has is "who is behind".
 * A row opens in a drawer; the admin reads a track, never marks it.
 */
type PaceFilter = '' | SyllabusPace;

export default function SyllabusOverviewPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const hydrated = useHydrated();
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [pace, setPace] = useState<PaceFilter>('');
  const [open, setOpen] = useState<{ classSectionId: string; subjectId: string } | null>(null);

  const q = useQuery({ queryKey: ['syllabus-overview', host], enabled: !!host, retry: false, queryFn: () => api.get<SyllabusOverview>('/manage/syllabus/overview') });
  const detail = useQuery({
    queryKey: ['syllabus-track', host, open?.classSectionId, open?.subjectId],
    enabled: !!host && !!open,
    queryFn: () => api.get<SyllabusTrack>(`/manage/syllabus/tracks/${open!.classSectionId}/${open!.subjectId}`),
  });

  const d = q.data;
  const sections = useMemo(() => (d?.sections ?? []).filter((s) => !gradeId || s.gradeId === gradeId), [d, gradeId]);
  const rows = useMemo(() => {
    const all = (d?.tracks ?? []).filter(
      (t) => (!gradeId || t.gradeId === gradeId) && (!sectionId || t.classSectionId === sectionId) && (!subjectId || t.subjectId === subjectId) && (!teacherId || t.teacher?.id === teacherId) && (!pace || t.pace === pace),
    );
    return all.slice().sort(worstFirst);
  }, [d, gradeId, sectionId, subjectId, teacherId, pace]);
  const measured = rows.filter((t) => t.pace !== 'none');
  const avg = measured.length ? Math.round(measured.reduce((s, t) => s + t.pct, 0) / measured.length) : 0;
  const behind = rows.filter((t) => t.pace === 'bad');
  const slightly = rows.filter((t) => t.pace === 'warn');
  const attention = rows.filter((t) => t.pace === 'bad' || t.pace === 'warn').slice(0, 5);

  if (isPlanRefusal(q.error)) return <NotInPlan />;

  return (
    <HubPage
      title="Syllabus"
      subtitle="Where every class has reached, against how much of the year has gone."
      action={<Link className="sk-btn sk-press" href="/app/syllabus/chapters">Chapter lists</Link>}
    >
      {q.isError && <QueryError error={q.error} onRetry={q.refetch} />}
      {q.isLoading && <p className="sk-state">Reading the year…</p>}
      {d && !d.year && (
        <p className="sk-state" data-testid="syl-no-year">
          No current session yet. Set one under Settings → School year, and every section of it appears here.
        </p>
      )}
      {d && d.year && (
        <>
          <section className="sk-card" aria-label="Filters">
            <div className="sk-card-b">
              <div className="sk-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
                <label className="sk-sronly" htmlFor="syl-f-grade">Class</label>
                <select id="syl-f-grade" className="sk-input sk-toolbar-pick" value={gradeId} onChange={(e) => { setGradeId(e.target.value); setSectionId(''); }} data-testid="syl-f-grade">
                  <option value="">Every class</option>
                  {d.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <label className="sk-sronly" htmlFor="syl-f-section">Section</label>
                <select id="syl-f-section" className="sk-input sk-toolbar-pick" value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="syl-f-section">
                  <option value="">Every section</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <label className="sk-sronly" htmlFor="syl-f-subject">Subject</label>
                <select id="syl-f-subject" className="sk-input sk-toolbar-pick" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} data-testid="syl-f-subject">
                  <option value="">Every subject</option>
                  {d.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <label className="sk-sronly" htmlFor="syl-f-teacher">Teacher</label>
                <select id="syl-f-teacher" className="sk-input sk-toolbar-pick" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} data-testid="syl-f-teacher">
                  <option value="">Every teacher</option>
                  {d.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <label className="sk-sronly" htmlFor="syl-f-pace">Status</label>
                <select id="syl-f-pace" className="sk-input sk-toolbar-pick" value={pace} onChange={(e) => setPace(e.target.value as PaceFilter)} data-testid="syl-f-pace">
                  <option value="">Any status</option>
                  <option value="bad">Behind</option>
                  <option value="warn">Slightly behind</option>
                  <option value="ok">On pace</option>
                  <option value="none">No chapters</option>
                </select>
                <span className="count">{rows.length} {rows.length === 1 ? 'track' : 'tracks'}</span>
              </div>
            </div>
          </section>

          <section className="sk-card" aria-label="This year">
            <div className="sk-card-b" style={{ display: 'grid', gap: 14 }}>
              <TrackHero
                t={{ pct: avg, expectedPct: d.year.expectedPct, pace: measured.length ? (behind.length ? 'bad' : slightly.length ? 'warn' : 'ok') : 'none', leaves: measured.length, done: 0, now: null }}
                title={measured.length ? `${behind.length + slightly.length} of ${measured.length} ${measured.length === 1 ? 'track is' : 'tracks are'} behind` : 'Nothing to measure yet'}
                line={`${d.year.name} · ${d.year.expectedPct}% of working days gone`}
                aggregate
              />
              <Figures count={3}>
                <Figure value={rows.filter((t) => t.pace === 'ok').length} label="On pace" />
                <Figure value={slightly.length} label="Slightly behind" />
                <Figure value={behind.length} label="Behind" />
              </Figures>
            </div>
          </section>

          {attention.length > 0 && (
            <section className="sk-card" aria-label="Needs attention">
              <div className="sk-card-h"><h3>Needs attention</h3></div>
              <div className="sk-card-b">
                <RowList columns="minmax(0, 1.4fr) minmax(0, 1fr) auto" label="Needs attention">
                  {attention.map((t) => (
                    <Row key={`${t.classSectionId}:${t.subjectId}`} onClick={() => setOpen({ classSectionId: t.classSectionId, subjectId: t.subjectId })} testId={`syl-att-${t.classSectionId}-${t.subjectId}`}>
                      <Cell><RowTitle title={`${t.className} · ${t.subjectName}`} sub={t.teacher?.name ?? 'No teacher on the timetable'} /></Cell>
                      <Cell><span style={{ fontSize: 12.5, color: 'var(--sk-ink-2)' }}>{t.now ? `Now: ${t.now.title}` : 'Not started'}</span></Cell>
                      <Cell align="end"><span className="sk-pill" data-tone={PACE_TONE[t.pace]}>{gapLine(t)}</span></Cell>
                    </Row>
                  ))}
                </RowList>
              </div>
            </section>
          )}

          <section className="sk-card" aria-label="Every track">
            <div className="sk-card-h"><h3>Every section, worst first</h3></div>
            <div className="sk-card-b">
              {rows.length === 0 && (
                <p className="sk-state" style={{ margin: 0 }} data-testid="syl-empty">
                  {d.tracks.length === 0 ? 'No chapters and no timetable yet. Add chapter lists, and every section of the class appears here.' : 'Nothing matches these filters.'}
                </p>
              )}
              {rows.length > 0 && (
                <ScrollBox max={560} label={`${rows.length} tracks`}>
                  <RowList columns="minmax(0, 1.3fr) minmax(0, 0.9fr) 150px minmax(0, 1fr) auto auto" label="Tracks">
                    {rows.map((t) => <TrackRow key={`${t.classSectionId}:${t.subjectId}`} t={t} onOpen={() => setOpen({ classSectionId: t.classSectionId, subjectId: t.subjectId })} />)}
                  </RowList>
                </ScrollBox>
              )}
            </div>
          </section>
        </>
      )}

      {hydrated && open && (
        <Overlay
          title={detail.data ? `${detail.data.summary.className} · ${detail.data.summary.subjectName}` : 'Track'}
          subtitle={detail.data?.summary.teacher?.name ?? undefined}
          onClose={() => setOpen(null)}
          footer={<Link className="sk-btn sk-press" href={`/app/syllabus/chapters?gradeId=${detail.data?.summary.gradeId ?? ''}&subjectId=${open.subjectId}`}>Edit the chapter list</Link>}
        >
          {detail.isLoading && <p className="sk-state">Opening…</p>}
          {detail.isError && <p className="sk-state err">That track could not load.</p>}
          {detail.data && (
            <div style={{ display: 'grid', gap: 16 }}>
              <TrackHero t={detail.data.summary} title={gapLine(detail.data.summary)} line={`Last update ${sinceLine(detail.data.summary.lastUpdatedAt).toLowerCase()}`} />
              <ChapterList track={{ ...detail.data, canEdit: false }} />
            </div>
          )}
        </Overlay>
      )}
    </HubPage>
  );
}

function TrackRow({ t, onOpen }: { t: SyllabusTrackSummary; onOpen: () => void }) {
  return (
    <Row onClick={onOpen} testId={`syl-row-${t.classSectionId}-${t.subjectId}`}>
      <Cell><RowTitle title={`${t.className} · ${t.subjectName}`} sub={`${t.done} of ${t.leaves} done`} /></Cell>
      <Cell><span style={{ fontSize: 12.5, color: 'var(--sk-ink-2)' }}>{t.teacher?.name ?? 'No teacher on the timetable'}</span></Cell>
      <Cell>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <PaceRings pct={t.pct} expectedPct={t.expectedPct} size={36} stroke={5} />
          <div className="sk-syl-bars" style={{ flex: 1 }} aria-label={`Taught ${t.pct}%, expected ${t.expectedPct}%`}>
            <div className="sk-syl-bar"><i style={{ width: `${t.pct}%`, background: TAUGHT_COLOR }} /></div>
            <div className="sk-syl-bar"><i style={{ width: `${t.expectedPct}%`, background: EXPECTED_COLOR }} /></div>
          </div>
        </div>
      </Cell>
      <Cell><span style={{ fontSize: 12.5, color: 'var(--sk-ink)' }}>{t.now ? t.now.title : t.leaves ? 'All done' : 'No chapters'}</span></Cell>
      <Cell align="end"><span className="sk-pill" data-tone={PACE_TONE[t.pace]}>{PACE_LABEL[t.pace]}</span></Cell>
      <Cell align="end"><span className="sk-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{sinceLine(t.lastUpdatedAt)}</span></Cell>
    </Row>
  );
}
