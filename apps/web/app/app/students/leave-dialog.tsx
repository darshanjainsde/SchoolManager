'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import DialogShell from '@/components/ui/dialog-shell';

export interface LeaveStudent {
  id: string;
  firstName: string;
  lastName: string;
  admissionNo: string;
}

interface Clearance {
  libraryIssuesOut: number;
  finesDueRupees: number;
  feeDuesRupees: number;
  unsignedRemarks: number;
  hasHistory: boolean;
}

export type LeaveStatus = 'ALUMNI' | 'TRANSFERRED' | 'LEFT';

const OPTIONS: { value: LeaveStatus; label: string; hint: string }[] = [
  { value: 'TRANSFERRED', label: 'Moved to another school', hint: 'A transfer certificate was, or will be, issued.' },
  { value: 'ALUMNI', label: 'Passed out', hint: 'Finished the final class. Goes on the alumni roll.' },
  { value: 'LEFT', label: 'Left for another reason', hint: 'Withdrawn, a long absence, or anything else.' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Mark as left" — the office's replacement for Delete (Active Roster).
 *
 * One child or a whole selection: the record and its history stay, the child
 * leaves every register, diary and notice from today, and the login closes.
 * The clearance line warns (books out, fees, unsigned remarks) and never
 * blocks — the same rule the leave policy follows.
 */
export default function LeaveDialog({
  students,
  hasPress = false,
  onDone,
  onCancel,
}: {
  students: LeaveStudent[];
  /** The school has the Print Store, so a Transfer Certificate is one click away. */
  hasPress?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const single = students.length === 1 ? students[0] : null;
  const [status, setStatus] = useState<LeaveStatus>('TRANSFERRED');
  const [leftOn, setLeftOn] = useState(todayIso);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(0);

  const clearance = useQuery({
    queryKey: ['student-clearance', single?.id],
    queryFn: () => api.get<Clearance>(`/manage/students/${single!.id}/clearance`),
    enabled: !!host && !!single,
    staleTime: 10_000,
  });

  const leave = useMutation({
    mutationFn: async () => {
      // One request per child, in order, so a failure names the one it stopped at.
      for (let i = 0; i < students.length; i++) {
        await api.post(`/manage/students/${students[i].id}/leave`, {
          status,
          leftOn,
          reason: reason.trim() || undefined,
          note: note.trim() || undefined,
        });
        setProgress(i + 1);
      }
    },
    onSuccess: () => {
      const who = single ? `${single.firstName} ${single.lastName}` : `${students.length} students`;
      if (hasPress && status === 'TRANSFERRED') {
        toast.success(`${who} marked as left`, {
          description: 'A Transfer Certificate is one click away in the Print Store.',
          action: { label: 'Order a TC', onClick: () => window.location.assign('/app/press') },
        });
      } else {
        toast.success(`${who} marked as left`);
      }
      onDone();
    },
    onError: (e: Error) =>
      toast.error(
        students.length > 1
          ? `Stopped at student ${progress + 1} of ${students.length}: ${e.message}`
          : e.message,
      ),
  });

  const c = clearance.data;
  const warnings: string[] = [];
  if (c) {
    if (c.libraryIssuesOut > 0) warnings.push(`${c.libraryIssuesOut} library ${c.libraryIssuesOut === 1 ? 'book' : 'books'} still out`);
    if (c.finesDueRupees > 0) warnings.push(`₹${c.finesDueRupees.toLocaleString('en-IN')} in library fines due`);
    if (c.feeDuesRupees > 0) warnings.push(`₹${c.feeDuesRupees.toLocaleString('en-IN')} in fees outstanding`);
    if (c.unsignedRemarks > 0) warnings.push(`${c.unsignedRemarks} diary ${c.unsignedRemarks === 1 ? 'remark' : 'remarks'} not signed`);
  }

  return (
    <DialogShell onClose={onCancel} labelledBy="leave-title" maxWidth={480}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!leave.isPending) leave.mutate();
        }}
      >
        <div className="sk-card-h">
          <h3 id="leave-title">
            {single ? `Mark ${single.firstName} ${single.lastName} as left` : `Mark ${students.length} students as left`}
          </h3>
          <p>Their record and history stay. They leave every register, diary and notice from today, and their login closes.</p>
        </div>

        <div className="sk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {warnings.length > 0 && (
            <div className="sk-notice" role="status" style={{ marginTop: 0 }}>
              <strong>Before they go</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <legend className="sk-lab">Why</legend>
            {OPTIONS.map((o) => (
              <label
                key={o.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '9px 11px',
                  border: '1.5px solid',
                  borderColor: status === o.value ? 'var(--sk-brand)' : 'var(--sk-line)',
                  borderRadius: 'var(--sk-r-sm)',
                  background: status === o.value ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="leave-status"
                  value={o.value}
                  checked={status === o.value}
                  onChange={() => setStatus(o.value)}
                  aria-label={o.label}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: 'var(--sk-ink)' }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--sk-ink-2)' }}>{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="sk-lab">Left on</span>
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
                placeholder="Moved city, joined DPS…"
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="sk-lab">Note (office only)</span>
            <textarea className="sk-input" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
          </label>
        </div>

        <div className="sk-card-b" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 0 }}>
          <button type="button" className="sk-btn sk-press" onClick={onCancel} disabled={leave.isPending}>
            Cancel
          </button>
          <button type="submit" className="sk-btn sk-press" data-variant="primary" disabled={leave.isPending}>
            {leave.isPending ? (students.length > 1 ? `Marking ${progress}/${students.length}…` : 'Marking…') : 'Mark as left'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
