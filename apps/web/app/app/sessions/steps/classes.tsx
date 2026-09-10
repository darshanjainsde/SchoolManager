'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { classLabel, type ClassRow, type PlanView } from '../types';

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  status?: 'ACTIVE' | 'LEFT';
}

/**
 * Step 2. Copy this year's classes into the next session, give each a class
 * teacher, and say where each closing class goes — the default is the same
 * section one grade up, the top grade passes out.
 */
export default function ClassesStep({ plan, onNext }: { plan: PlanView; onNext: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const [draftMap, setDraftMap] = useState<Record<string, string> | null>(null);

  const closing = useQuery<ClassRow[]>({
    queryKey: ['mng-classes', host, plan.fromYearId],
    queryFn: () => api.get(`/manage/classes?academicYearId=${plan.fromYearId}`),
    enabled: !!host,
  });
  const next = useQuery<ClassRow[]>({
    queryKey: ['mng-classes', host, plan.toYearId],
    queryFn: () => api.get(`/manage/classes?academicYearId=${plan.toYearId}`),
    enabled: !!host,
  });
  const teachers = useQuery<Teacher[]>({
    queryKey: ['mng-teachers', host],
    queryFn: () => api.get('/manage/teachers'),
    enabled: !!host,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['mng-classes', host] });
    void queryClient.invalidateQueries({ queryKey: ['sessions', host] });
  };

  const copy = useMutation({
    mutationFn: () => api.post<{ created: number; existing: number }>('/manage/sessions/plan/structure/copy', {}),
    onSuccess: (r) => {
      setDraftMap(null);
      refreshAll();
      toast.success(r.created ? `${r.created} classes created for ${plan.toYear.name}` : 'Classes were already there — nothing to add');
    },
    onError: (err: Error) => toast.error(`Could not copy the classes: ${err.message}`),
  });

  const setTeacher = useMutation({
    mutationFn: ({ id, classTeacherId }: { id: string; classTeacherId: string | null }) => api.put(`/manage/classes/${id}`, { classTeacherId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['mng-classes', host, plan.toYearId] }),
    onError: (err: Error) => toast.error(`Could not set the class teacher: ${err.message}`),
  });

  const saveMap = useMutation({
    mutationFn: (sectionMap: Record<string, string>) => api.patch('/manage/sessions/plan', { sectionMap }),
    onSuccess: () => {
      setDraftMap(null);
      refreshAll();
      toast.success('Class mapping saved');
    },
    onError: (err: Error) => toast.error(`Could not save the mapping: ${err.message}`),
  });

  const map = draftMap ?? plan.sectionMap ?? {};
  const nextRows = next.data ?? [];
  const copied = nextRows.length > 0;
  const activeTeachers = useMemo(() => (teachers.data ?? []).filter((t) => !t.status || t.status === 'ACTIVE'), [teachers.data]);
  const withoutTeacher = nextRows.filter((c) => !c.classTeacherId).length;

  return (
    <div className="sk-card-b">
      <div className="sk-ses-copyrow">
        <div>
          <b>Classes for {plan.toYear.name}</b>
          <p className="sk-muted" style={{ marginTop: 2 }}>
            {copied
              ? `${nextRows.length} classes · ${withoutTeacher ? `${withoutTeacher} without a class teacher` : 'every class has a teacher'}`
              : `Copy this year's ${closing.data?.length ?? ''} classes across. Class teachers who left are not carried.`}
          </p>
        </div>
        <button type="button" className="sk-btn sk-press" data-variant={copied ? undefined : 'primary'} disabled={copy.isPending} onClick={() => copy.mutate()}>
          {copy.isPending ? 'Copying…' : copied ? 'Copy again (adds what is missing)' : "Copy this year's classes"}
        </button>
      </div>

      {copied && (
        <>
          <span className="sk-lab">Class teachers</span>
          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Class teacher</th>
                </tr>
              </thead>
              <tbody>
                {nextRows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {classLabel(c)}
                      {!c.classTeacherId && (
                        <span className="sk-pill" data-tone="warn" style={{ marginLeft: 8 }}>
                          No class teacher
                        </span>
                      )}
                    </td>
                    <td>
                      <select
                        className="sk-input"
                        aria-label={`Class teacher for ${classLabel(c)}`}
                        value={c.classTeacherId ?? ''}
                        disabled={setTeacher.isPending}
                        onChange={(e) => setTeacher.mutate({ id: c.id, classTeacherId: e.target.value || null })}
                      >
                        <option value="">— None yet —</option>
                        {activeTeachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.firstName} {t.lastName}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <span className="sk-lab">Where each class goes</span>
          <p className="sk-muted">The default is the same section one grade up; the top grade passes out. Change any row — this is what “Promote” means for that class.</p>
          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead>
                <tr>
                  <th>{plan.fromYear.name}</th>
                  <th>{plan.toYear.name}</th>
                </tr>
              </thead>
              <tbody>
                {(closing.data ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>{classLabel(c)}</td>
                    <td>
                      <select
                        className="sk-input"
                        aria-label={`${classLabel(c)} goes to`}
                        value={map[c.id] ?? 'PASS_OUT'}
                        onChange={(e) => setDraftMap({ ...map, [c.id]: e.target.value })}
                      >
                        {nextRows.map((n) => (
                          <option key={n.id} value={n.id}>
                            {classLabel(n)}
                          </option>
                        ))}
                        <option value="PASS_OUT">Passes out (alumni)</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sk-cel-actions">
            {draftMap ? (
              <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={saveMap.isPending} onClick={() => saveMap.mutate(map)}>
                {saveMap.isPending ? 'Saving…' : 'Save mapping'}
              </button>
            ) : (
              <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={onNext}>
                Next: decide students
              </button>
            )}
            {draftMap && (
              <button type="button" className="sk-btn sk-press" onClick={() => setDraftMap(null)}>
                Discard
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
