'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CopyCheck, School, UserCheck, Users } from 'lucide-react';
import type { ClassTeacherDesk, ClassTeacherRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { HubKpi, HubKpis, HubPage } from '@/components/ui/hub';
import { Cell, Row, RowList, RowTitle, ScrollBox } from '@/components/ui/kit';

/**
 * CLASS TEACHERS — who owns each section, in one place.
 *
 * It existed as one optional field on the Classes form, and seven things
 * already lean on it: who may take a section's attendance, who may write its
 * class notes, whose name signs its report cards, what a new session copies
 * forward, what the teacher's own profile says, what the onboarding sheet
 * fills in — and now who a family reaches when the Complaint Box routes to
 * "my class teacher". Nothing told a school when it was empty.
 *
 * A teacher holding two sections is ALLOWED and said out loud on the row; a
 * teacher who has left cannot be chosen at all.
 */
type Filter = 'ALL' | 'UNASSIGNED' | 'DOUBLED';

export default function ClassTeachersPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');

  const desk = useQuery({
    queryKey: ['class-teachers', host], enabled: !!host,
    queryFn: () => api.get<ClassTeacherDesk>('/manage/class-teachers'),
  });

  const assign = useMutation({
    mutationFn: ({ classSectionId, teacherId }: { classSectionId: string; teacherId: string | null }) =>
      api.put<ClassTeacherRow>(`/manage/class-teachers/${classSectionId}`, { teacherId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['class-teachers'] }); void qc.invalidateQueries({ queryKey: ['mng-classes'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = useMutation({
    mutationFn: (fromYearId: string) => api.post<{ copied: number; skippedLeft: number; skippedNoMatch: number }>('/manage/class-teachers/copy', { fromYearId }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['class-teachers'] });
      toast.success(
        r.copied === 0
          ? 'Nothing to carry over — no section matched by name.'
          : `Carried ${r.copied} over${r.skippedLeft ? ` · ${r.skippedLeft} skipped (teacher has left)` : ''}${r.skippedNoMatch ? ` · ${r.skippedNoMatch} had no match` : ''}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = desk.data;
  const rows = useMemo(() => {
    const all = d?.rows ?? [];
    if (filter === 'UNASSIGNED') return all.filter((r) => !r.teacher);
    if (filter === 'DOUBLED') return all.filter((r) => r.alsoHolds.length > 0);
    return all;
  }, [d, filter]);

  const action = d?.previousYear ? (
    <button
      className="sk-btn sk-press"
      disabled={copy.isPending}
      onClick={() => copy.mutate(d.previousYear!.id)}
    >
      <CopyCheck size={15} aria-hidden="true" />
      {copy.isPending ? 'Carrying over…' : `Copy from ${d.previousYear.name}`}
    </button>
  ) : null;

  return (
    <HubPage
      title="Class teachers"
      subtitle="One teacher owns each section for the session. Every child's class teacher comes from here — and so does who can take the register, write class notes, sign a report card and answer a family."
      action={action}
    >
      {desk.isLoading && <p className="sk-state">Opening the list…</p>}
      {desk.isError && <p className="sk-state err">That list could not load. Refresh to try again.</p>}

      {d && !d.academicYear && (
        <div className="sk-card"><div className="sk-card-b">
          <p className="sk-state" style={{ margin: 0 }}>
            No session is current yet. Start one under <Link href="/app/sessions" style={{ color: 'var(--sk-brand-2)' }}>Sessions</Link> and the classes of that year will show here.
          </p>
        </div></div>
      )}

      {d?.academicYear && (
        <>
          <HubKpis>
            <HubKpi label={`Sections · ${d.academicYear.name}`} value={d.counts.sections} hint="in this session" />
            <HubKpi label="Assigned" value={d.counts.assigned} hint={`of ${d.counts.sections}`} tone={d.counts.assigned === d.counts.sections && d.counts.sections > 0 ? 'good' : undefined} />
            <HubKpi
              label="Nobody yet" value={d.counts.unassigned}
              hint={d.counts.unassigned ? 'these classes have no class teacher' : 'every class has one'}
              tone={d.counts.unassigned ? 'bad' : 'good'}
            />
            <HubKpi
              label="Holding two or more" value={d.counts.holdingMoreThanOne}
              hint={d.counts.holdingMoreThanOne ? 'allowed — shown on the row' : 'nobody is doubled up'}
              tone={d.counts.holdingMoreThanOne ? 'warn' : undefined}
            />
          </HubKpis>

          <section className="sk-card sk-hublist" aria-label="Sections">
            <div className="sk-card-h sk-hublist-h">
              <h3>Every class</h3>
              <div className="sk-hubchips" role="group" aria-label="Show">
                {([['ALL', `All · ${d.counts.sections}`], ['UNASSIGNED', `Nobody yet · ${d.counts.unassigned}`], ['DOUBLED', `Holding two · ${d.counts.holdingMoreThanOne}`]] as const).map(([f, label]) => (
                  <button key={f} type="button" className="sk-hubchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="sk-card-b">
              {rows.length === 0 ? (
                <p className="sk-state" style={{ margin: 0 }}>
                  {filter === 'UNASSIGNED' ? 'Every class has a class teacher.' : filter === 'DOUBLED' ? 'Nobody is holding more than one class.' : 'No classes in this session yet.'}
                </p>
              ) : (
                <>
                  <p className="sk-muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
                    {rows.length} {rows.length === 1 ? 'class' : 'classes'}{rows.length > 8 ? ' — scroll for more' : ''}
                  </p>
                  {/* A school with 64 sections is normal, so the list scrolls in
                      its own box and the count above says how long it is. */}
                  <ScrollBox max={520} label={`${rows.length} classes`}>
                    <RowList columns="minmax(0, 1fr) minmax(0, 1.2fr) auto" label="Sections and their class teachers">
                      {rows.map((r) => (
                        <Row key={r.classSectionId}>
                          <Cell>
                            <RowTitle
                              title={r.label}
                              sub={`${r.students} ${r.students === 1 ? 'child' : 'children'}`}
                            />
                          </Cell>
                          <Cell>
                            <label className="sk-sronly" htmlFor={`ct-${r.classSectionId}`}>Class teacher for {r.label}</label>
                            <select
                              id={`ct-${r.classSectionId}`}
                              className="sk-input sk-ctpick"
                              data-empty={!r.teacher || undefined}
                              value={r.teacher?.id ?? ''}
                              disabled={assign.isPending}
                              onChange={(e) => assign.mutate({ classSectionId: r.classSectionId, teacherId: e.target.value || null })}
                            >
                              <option value="">Nobody yet</option>
                              {(d.teachers ?? []).map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                            {r.alsoHolds.length > 0 && (
                              <span className="sk-ctwarn">
                                <AlertTriangle size={12} aria-hidden="true" /> also holds {r.alsoHolds.join(', ')}
                              </span>
                            )}
                          </Cell>
                          <Cell align="end">
                            {r.teacher
                              ? <span className="sk-pill" data-tone="good">Assigned</span>
                              : <span className="sk-pill" data-tone="bad">Nobody</span>}
                          </Cell>
                        </Row>
                      ))}
                    </RowList>
                  </ScrollBox>
                </>
              )}
            </div>
          </section>

          <div className="sk-cardgrid sk-hubdoors">
            <Link href="/app/classes" className="sk-entity sk-press sk-hubdoor">
              <span className="av" style={{ background: 'var(--sk-brand)' }}><School size={20} aria-hidden="true" /></span>
              <span className="sk-hubdoor-text"><span className="nm">Classes</span><span className="meta">Add a class or a section</span></span>
            </Link>
            <Link href="/app/teachers" className="sk-entity sk-press sk-hubdoor">
              <span className="av" style={{ background: 'var(--sk-ink-2)' }}><Users size={20} aria-hidden="true" /></span>
              <span className="sk-hubdoor-text"><span className="nm">Teachers</span><span className="meta">{d.teachers.length} on the roll</span></span>
            </Link>
            <Link href="/app/concerns" className="sk-entity sk-press sk-hubdoor">
              <span className="av" style={{ background: 'var(--sk-good)' }}><UserCheck size={20} aria-hidden="true" /></span>
              <span className="sk-hubdoor-text"><span className="nm">Complaint Box</span><span className="meta">Where a family reaches their class teacher</span></span>
            </Link>
          </div>
        </>
      )}
    </HubPage>
  );
}
