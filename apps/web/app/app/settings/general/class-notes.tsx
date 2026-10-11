'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ClassNoteVisibilityValue } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { SettingsCard, SettingsSection } from '../section';

const CLASS_NOTE_VISIBILITY_OPTIONS: { value: ClassNoteVisibilityValue; label: string; description: string }[] = [
  {
    value: 'ALL_TEACHERS',
    label: 'Any teacher of the class',
    description: 'Whoever teaches the class, any subject, can read and add its notes and to-dos.',
  },
  {
    value: 'SUBJECT_TEACHERS',
    label: 'Only the subject’s teachers',
    description:
      'A note stays with its subject: only that subject’s teachers (and a substitute covering it that day) can read it. The class teacher always sees every subject for their own class.',
  },
];

export function ClassNotesSection() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['mng-class-note-visibility'],
    queryFn: () => api.get<{ classNoteVisibility: ClassNoteVisibilityValue }>('/manage/school/class-note-visibility'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const update = useMutation({
    mutationFn: (classNoteVisibility: ClassNoteVisibilityValue) =>
      api.put<{ classNoteVisibility: ClassNoteVisibilityValue }>('/manage/school/class-note-visibility', { classNoteVisibility }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mng-class-note-visibility'] });
      toast.success('Class notes visibility updated');
    },
    onError: (err: Error) => toast.error(`Failed to update class notes visibility: ${err.message}`),
  });
  const value = q.data?.classNoteVisibility;

  return (
    <SettingsSection
      title="Class notes visibility"
      hint="Who can read a class's notes and to-dos. Teachers keep these as a handover log."
      testId="class-notes-section"
    >
      <SettingsCard>
        {q.isLoading ? <p className="sk-state">Loading…</p> : null}
        {q.error ? <p className="sk-state err">{(q.error as Error).message}</p> : null}
        {!q.isLoading && !q.error ? (
          <div className="sk-setchoice" role="radiogroup" aria-label="Class notes visibility">
            {CLASS_NOTE_VISIBILITY_OPTIONS.map((opt) => (
              <label key={opt.value} data-on={value === opt.value || undefined} style={{ cursor: update.isPending ? 'default' : 'pointer' }}>
                <input type="radio" name="class-note-visibility" value={opt.value} checked={value === opt.value}
                  disabled={update.isPending} onChange={() => update.mutate(opt.value)} />
                <span><span className="n">{opt.label}</span><span className="h">{opt.description}</span></span>
              </label>
            ))}
          </div>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

