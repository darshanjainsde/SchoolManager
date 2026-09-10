'use client';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
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
