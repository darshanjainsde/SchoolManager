'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { TimetableEditor, type SchoolClass } from '@/components/timetable/TimetableEditor';
import type { PlanView } from '../types';

/** Step 5. What else comes across with the session. */
export default function CopyRestStep({ plan, onNext }: { plan: PlanView; onNext: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (patch: { copyTimetable?: boolean; carryLeave?: boolean }) => api.patch('/manage/sessions/plan', patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sessions', host] }),
    onError: (err: Error) => toast.error(`Could not save: ${err.message}`),
  });
  return (
    <div className="sk-card-b">
      <div className="sk-cel-switchrow">
        <span>
          Copy the timetable
          <small>Each classroom’s periods carry into the same class next year — 5 B’s timetable becomes the new 5 B’s. Teachers who left are skipped, so those periods show as free.</small>
        </span>
        <button type="button" role="switch" aria-checked={plan.copyTimetable} aria-label="Copy the timetable" className="sk-switch" disabled={save.isPending} onClick={() => save.mutate({ copyTimetable: !plan.copyTimetable })} />
      </div>
      {plan.copyTimetable && <TimetablePreview plan={plan} />}
      <div className="sk-cel-switchrow">
        <span>
          Carry unused leave forward
          <small>Teachers’ unused leave moves into {plan.toYear.name}, up to each leave type’s carry-forward cap.</small>
        </span>
        <button type="button" role="switch" aria-checked={plan.carryLeave} aria-label="Carry unused leave forward" className="sk-switch" disabled={save.isPending} onClick={() => save.mutate({ carryLeave: !plan.carryLeave })} />
      </div>
      <p className="sk-cel-hint">
        Holidays are entered per year under <Link href="/app/settings" className="underline">Settings</Link>. Fees for the new session are set up in Fees once it has started.
      </p>
      <div className="sk-cel-actions">
        <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={onNext}>
          Next: review &amp; start
        </button>
      </div>
    </div>
  );
}

/**
 * "Preview and adjust": collapsed until asked for. Opening it copies the
 * timetable into the next year now (effective from the session's first day;
 * what is already there is kept) and mounts the ordinary timetable editor over
 * the next year's classes, anchored on that first day. Start copies again and
 * skips every period that already exists, so nothing done here is lost.
 */
function TimetablePreview({ plan }: { plan: PlanView }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [classSectionId, setClassSectionId] = useState('');
  const classes = useQuery<SchoolClass[]>({
    queryKey: ['mng-classes', host, plan.toYearId],
    queryFn: () => api.get(`/manage/classes?academicYearId=${plan.toYearId}`),
    enabled: !!host && open,
  });
  const copy = useMutation({
    mutationFn: () => api.post<{ copied: number; skipped: number; nextYearClasses: number }>('/manage/sessions/plan/timetable/copy', {}),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['timetable'] });
      if (r.nextYearClasses === 0) toast.error('Copy the classes in step 2 first — the next year has no classes yet.');
      else toast.success(r.copied ? `${r.copied} periods copied into ${plan.toYear.name}${r.skipped ? ` · ${r.skipped} skipped (already placed, or a teacher who left)` : ''}` : 'Nothing new to copy — the next year already has these periods');
    },
    onError: (err: Error) => toast.error(`Could not copy the timetable: ${err.message}`),
  });
  const show = () => {
    setOpen(true);
    copy.mutate();
  };
  return (
    <div className="sk-ses-ttprev">
      {!open ? (
        <button type="button" className="sk-btn sk-press" onClick={show}>
          Preview and adjust {plan.toYear.name}’s timetable
        </button>
      ) : (
        <>
          <p className="sk-cel-hint">
            This is {plan.toYear.name}’s timetable as it will start, class by class. Move any period now; Start keeps what you set here.
          </p>
          <TimetableEditor
            classes={classes.data ?? []}
            classesLoading={classes.isLoading || copy.isPending}
            classSectionId={classSectionId}
            onClassSectionChange={setClassSectionId}
            anchorDate={new Date(plan.toYear.startDate)}
          />
        </>
      )}
    </div>
  );
}
