'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import DialogShell from '@/components/ui/dialog-shell';

export interface ReleaseTeacher {
  id: string;
  firstName: string;
  lastName: string;
}

interface ReleaseImpact {
  classTeacherOf: { id: string; label: string }[];
  timetableSlots: number;
  pendingLeave: number;
  featuredOnWebsite: boolean;
  libraryIssuesOut: number;
  openThreads: number;
}

interface TeacherOption {
  id: string;
  firstName: string;
  lastName: string;
  status?: 'ACTIVE' | 'LEFT';
  isActive: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const selectStyle = { maxWidth: 260, width: '100%' } as const;

/**
 * "Remove from this school" — the handover sheet (Active Roster).
 *
 * Before the office confirms, it sees exactly what the teacher still holds and
 * decides each line: who takes each class-teacher seat, where the open
 * periods go, whether the website card stays. Then the row is marked LEFT and
 * the login closes, which is what frees the teacher to be onboarded elsewhere.
 */
export default function ReleaseSheet({
  teacher,
  onDone,
  onCancel,
}: {
  teacher: ReleaseTeacher;
  onDone: () => void;
  onCancel: () => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const name = `${teacher.firstName} ${teacher.lastName}`;
  const [leftOn, setLeftOn] = useState(todayIso);
  const [reason, setReason] = useState('');
  const [seats, setSeats] = useState<Record<string, string>>({});
  const [timetableTeacherId, setTimetableTeacherId] = useState('');
  const [keepFeatured, setKeepFeatured] = useState(false);

  const impact = useQuery({
    queryKey: ['teacher-release-impact', teacher.id],
    queryFn: () => api.get<ReleaseImpact>(`/manage/teachers/${teacher.id}/release-impact`),
    enabled: !!host,
  });
  const teachers = useQuery({
    queryKey: ['mng-teachers'],
    queryFn: () => api.get<TeacherOption[]>('/manage/teachers'),
    enabled: !!host,
    staleTime: 30_000,
  });
  const replacements = (teachers.data ?? []).filter((t) => t.id !== teacher.id && t.isActive);

  const release = useMutation({
    mutationFn: () =>
      api.post(`/manage/teachers/${teacher.id}/release`, {
        leftOn,
        reason: reason.trim() || undefined,
        handover: {
          classSections: Object.fromEntries((impact.data?.classTeacherOf ?? []).map((s) => [s.id, seats[s.id] || null])),
          timetableTeacherId: timetableTeacherId || null,
          keepFeatured,
        },
      }),
    onSuccess: () => {
      toast.success(`${name} removed from this school`, {
        description: 'Their record and history stay. Another school can onboard them now.',
      });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const i = impact.data;
  const lines: { key: string; text: string; control?: React.ReactNode }[] = [];
  if (i) {
    for (const s of i.classTeacherOf) {
      lines.push({
        key: `seat-${s.id}`,
        text: `Class teacher of ${s.label}`,
        control: (
          <select
            className="sk-input"
            style={selectStyle}
            aria-label={`New class teacher for ${s.label}`}
            value={seats[s.id] ?? ''}
            onChange={(e) => setSeats((prev) => ({ ...prev, [s.id]: e.target.value }))}
          >
            <option value="">Leave the seat empty for now</option>
            {replacements.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </select>
        ),
      });
    }
    if (i.timetableSlots > 0) {
      lines.push({
        key: 'slots',
        text: `${i.timetableSlots} timetable ${i.timetableSlots === 1 ? 'period' : 'periods'}`,
        control: (
          <select
            className="sk-input"
            style={selectStyle}
            aria-label="Hand periods to"
            value={timetableTeacherId}
            onChange={(e) => setTimetableTeacherId(e.target.value)}
          >
            <option value="">Mark as unassigned</option>
            {replacements.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </select>
        ),
      });
    }
    if (i.pendingLeave > 0) {
      lines.push({ key: 'leave', text: `${i.pendingLeave} pending leave ${i.pendingLeave === 1 ? 'application' : 'applications'} will be declined` });
    }
    if (i.featuredOnWebsite) {
      lines.push({
        key: 'featured',
        text: "Shown on the website's Educators section",
        control: (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={keepFeatured} onChange={(e) => setKeepFeatured(e.target.checked)} />
            Keep them on the website
          </label>
        ),
      });
    }
    if (i.libraryIssuesOut > 0) {
      lines.push({ key: 'library', text: `${i.libraryIssuesOut} library ${i.libraryIssuesOut === 1 ? 'book' : 'books'} still out` });
    }
    if (i.openThreads > 0) {
      lines.push({ key: 'threads', text: `${i.openThreads} message ${i.openThreads === 1 ? 'thread becomes' : 'threads become'} read-only for families` });
    }
  }

  return (
    <DialogShell onClose={onCancel} labelledBy="release-title" maxWidth={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!release.isPending && impact.data) release.mutate();
        }}
      >
        <div className="sk-card-h">
          <h3 id="release-title">Remove {name} from this school</h3>
          <p>Their record and history stay here. Their login closes, and another school can onboard them.</p>
        </div>

        <div className="sk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {impact.isLoading && <p className="sk-state">Checking what they still hold…</p>}
          {impact.error && <p className="sk-state err">{(impact.error as Error).message}</p>}
          {i && lines.length === 0 && <p className="sk-state">They hold no classes, periods or leave — nothing to hand over.</p>}
          {lines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="sk-lab">What they still hold</span>
              {lines.map((l) => (
                <div
                  key={l.key}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '9px 11px',
                    border: '1px solid var(--sk-line)',
                    borderRadius: 'var(--sk-r-sm)',
                    background: 'var(--sk-bg-2)',
                    fontSize: 13.5,
                  }}
                >
                  <span>{l.text}</span>
                  {l.control}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="sk-lab">Leaving on</span>
              <input className="sk-input" type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} required />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="sk-lab">Reason</span>
              <input
                className="sk-input"
                aria-label="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={120}
                placeholder="Resigned, moved school, retired…"
              />
            </label>
          </div>
        </div>

        <div className="sk-card-b" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 0 }}>
          <button type="button" className="sk-btn sk-press" onClick={onCancel} disabled={release.isPending}>
            Cancel
          </button>
          <button type="submit" className="sk-btn sk-press" data-variant="primary" disabled={release.isPending || !impact.data}>
            {release.isPending ? 'Removing…' : 'Remove from this school'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
