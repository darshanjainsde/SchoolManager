'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { PlanView, RollPolicy } from '../types';

const OPTIONS: { value: RollPolicy; label: string; hint: string }[] = [
  { value: 'KEEP', label: 'Keep', hint: 'Each child keeps the roll number they have. Gaps stay where children left.' },
  { value: 'ALPHABETICAL', label: 'Renumber by name', hint: 'Every new class is numbered 1, 2, 3… in first-name order.' },
  { value: 'ADMISSION_NO', label: 'Renumber by admission number', hint: 'Numbered in admission-number order, the way the register was written.' },
];

/** Step 4. One choice, applied per new class when the session starts. */
export default function RollNumbersStep({ plan, onNext }: { plan: PlanView; onNext: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (rollPolicy: RollPolicy) => api.patch('/manage/sessions/plan', { rollPolicy }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sessions', host] }),
    onError: (err: Error) => toast.error(`Could not save: ${err.message}`),
  });
  return (
    <div className="sk-card-b">
      <p className="sk-muted">Roll numbers in the new classes. Nothing changes until Start.</p>
      <div className="sk-cel-styles">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" className="sk-cel-style" aria-pressed={plan.rollPolicy === o.value} disabled={save.isPending} onClick={() => save.mutate(o.value)}>
            <b>{o.label}</b>
            <small>{o.hint}</small>
          </button>
        ))}
      </div>
      <div className="sk-cel-actions">
        <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={onNext}>
          Next: copy the rest
        </button>
      </div>
    </div>
  );
}
