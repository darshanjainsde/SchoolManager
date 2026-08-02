'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip, X } from 'lucide-react';
import type {
  Assignment,
  AssignmentList,
  AssignmentUploadResponse,
  MyClassSection,
  Subject,
} from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ConfirmDialog } from '@/components/teacher/ConfirmDialog';

const EMPTY_FORM = { subjectId: '', title: '', instructions: '', dueDate: '' };

/**
 * Mirrors `MAX_ATTACHMENT_BYTES` in
 * apps/api/src/modules/management/assignments.service.ts (4MB — comfortably
 * under Vercel's ~4.5MB serverless body cap). Checked here BEFORE a file is
 * ever handed to `fetch` — an oversized/wrong-type file never leaves the
 * browser, it just never reaches `POST /manage/assignments/upload`.
 */
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_MB = 4;
const MAX_ATTACHMENTS = 5;

function isAllowedAttachmentType(file: File): boolean {
  return file.type === 'application/pdf' || file.type.startsWith('image/');
}

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/**
 * `Assignment.dueDate` (`@db.Date`, `YYYY-MM-DD`) is a plain calendar date —
 * read with `timeZone: 'UTC'`, matching `HolidayList`'s `formatUTCDate`, so
 * it never rolls back a day in a negative-UTC-offset browser.
 */
function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function TeacherAssignmentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [classSectionId, setClassSectionId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachments, setAttachments] = useState<AssignmentUploadResponse[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const classes = useQuery({
    queryKey: ['t-assign-classes'],
    enabled: !!host,
    queryFn: () => api.get<MyClassSection[]>('/manage/attendance/my-classes'),
    staleTime: 30_000,
  });

  // A TEACHER may only post assignments for sections they own —
  // AssignmentsService rejects `covering: true` sections with a 403
  // CLASS_NOT_OWNED (mirrors Tests/Announcements). Filtering here means the
  // picker never offers a class the server will refuse.
  const ownedClasses = (classes.data ?? []).filter((c) => !c.covering);

  const subjects = useQuery({
    queryKey: ['t-assign-subjects'],
    enabled: !!host,
    queryFn: () => api.get<Subject[]>('/manage/subjects'),
    staleTime: 30_000,
  });

  const assignmentsQueryKey = ['t-assignments', classSectionId];
  const assignmentsQuery = useQuery({
    queryKey: assignmentsQueryKey,
    enabled: !!host && !!classSectionId,
    queryFn: () =>
      api.get<AssignmentList>(`/manage/assignments?classSectionId=${encodeURIComponent(classSectionId)}`),
  });

  async function handleFileSelected(file: File) {
    setAttachError(null);
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    // Client-side gate BEFORE any network call — an oversized or wrong-type
    // file never reaches `api.request`, it just shows an error here.
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(`"${file.name}" is too large — attachments are limited to ${MAX_ATTACHMENT_MB}MB.`);
      return;
    }
    if (!isAllowedAttachmentType(file)) {
      setAttachError(`"${file.name}" isn't a PDF or image — only PDF or image files can be attached.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const uploaded = await api.request<AssignmentUploadResponse>('/manage/assignments/upload', {
        method: 'POST',
        body: fd,
      });
      setAttachments((prev) => [...prev, uploaded]);
    } catch (e) {
      setAttachError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(url: string) {
    setAttachments((prev) => prev.filter((a) => a.url !== url));
  }

  const canCreate =
    !!classSectionId &&
    !!form.subjectId &&
    form.title.trim().length > 0 &&
    form.instructions.trim().length > 0 &&
    !!form.dueDate;

  const create = useMutation({
    mutationFn: () =>
      api.post<Assignment>('/manage/assignments', {
        classSectionId,
        subjectId: form.subjectId,
        title: form.title.trim(),
        instructions: form.instructions.trim(),
        dueDate: form.dueDate,
        attachments,
      }),
    onSuccess: (assignment) => {
      toast.success(`"${assignment.title}" posted.`);
      setForm(EMPTY_FORM);
      setAttachments([]);
      setAttachError(null);
      void qc.invalidateQueries({ queryKey: assignmentsQueryKey });
    },
    // { code, message } envelope — surface the message as-is.
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/manage/assignments/${id}`),
    onSuccess: () => {
      toast.success('Assignment deleted');
      setConfirmDeleteId(null);
      void qc.invalidateQueries({ queryKey: assignmentsQueryKey });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmDeleteId(null);
    },
  });

  const subjectLabel = (subjectId: string) => {
    const subject = (subjects.data ?? []).find((s) => s.id === subjectId);
    return subject ? `${subject.code} — ${subject.name}` : '—';
  };

  const upcoming = assignmentsQuery.data?.upcoming ?? [];
  const past = assignmentsQuery.data?.past ?? [];
  // The roster the "seen" count is a fraction OF. It already arrives with the
  // class picker's own query, so the seen bar costs no extra round trip — and
  // when it is missing (0, or a class not in the picker) the bar is simply not
  // drawn rather than being drawn against a guessed denominator.
  const rosterSize = ownedClasses.find((c) => c.classSectionId === classSectionId)?.studentCount ?? 0;
  const deletingId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null;
  const deletingTarget = [...upcoming, ...past].find((a) => a.id === confirmDeleteId) ?? null;

  return (
    <>
      <header className="sk-pagehead">
        <h1>Assignments</h1>
        <p>Set homework for a class, attach a worksheet, and see who has opened it.</p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Class</h3>
        </div>
        <div className="sk-card-b">
          <label htmlFor="assign-class" className="sk-lab">
            Class
          </label>
          <Select
            id="assign-class"
            className={`${fieldCls} max-w-sm`}
            value={classSectionId}
            onChange={(e) => setClassSectionId(e.target.value)}
          >
            <option value="">Pick a class…</option>
            {ownedClasses.map((c) => (
              <option key={c.classSectionId} value={c.classSectionId}>
                {c.name}
              </option>
            ))}
          </Select>
          {classes.error && <p className="sk-state err">{(classes.error as Error).message}</p>}
        </div>
      </div>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Post an assignment</h3>
        </div>
        <div className="sk-card-b">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="assign-subject" className="sk-lab">
                Subject
              </label>
              <Select
                id="assign-subject"
                className={`${fieldCls} w-full`}
                value={form.subjectId}
                onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
              >
                <option value="">—</option>
                {(subjects.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="assign-title" className="sk-lab">
                Title
              </label>
              <Input
                id="assign-title"
                className={`${fieldCls} w-full`}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                maxLength={160}
                placeholder="Worksheet 3"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="assign-due" className="sk-lab">
                Due date
              </label>
              <Input
                id="assign-due"
                type="date"
                className={`${fieldCls} w-full`}
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="assign-instructions" className="sk-lab">
                Instructions
              </label>
              <Textarea
                id="assign-instructions"
                rows={4}
                className={`${fieldCls} w-full`}
                value={form.instructions}
                onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                maxLength={4000}
                placeholder="Complete questions 1-10 and show your working."
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <span className="sk-lab">Attachments (optional)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  data-testid="assign-file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileSelected(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="sk-btn sk-press"
                  disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-3.5 w-3.5" style={{ marginRight: 6 }} aria-hidden="true" />
                  {uploading ? 'Uploading…' : 'Attach file'}
                </button>
                <span className="sk-muted">PDF or image, up to {MAX_ATTACHMENT_MB}MB each, {MAX_ATTACHMENTS} max.</span>
              </div>
              {attachError && (
                <p className="sk-state err" data-testid="attach-error">
                  {attachError}
                </p>
              )}
              {attachments.length > 0 && (
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {attachments.map((a) => (
                    <li
                      key={a.url}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      data-testid={`attachment-${a.name}`}
                    >
                      <span className="sk-muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.name} · {a.kind}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${a.name}`}
                        onClick={() => removeAttachment(a.url)}
                        style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sm:col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="sk-btn sk-press"
                data-variant="primary"
                disabled={!canCreate || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Posting…' : 'Post assignment'}
              </button>
              {!classSectionId && <span className="sk-muted">Pick a class first.</span>}
            </div>
          </div>
          {subjects.error && (
            <p className="sk-state err" style={{ marginTop: 12 }}>
              {(subjects.error as Error).message}
            </p>
          )}
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Posted assignments</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            {classSectionId
              ? `${upcoming.length} upcoming · ${past.length} past`
              : 'Pick a class to see its assignments.'}
          </p>
        </div>
        <div className="sk-card-b">
          {classSectionId && assignmentsQuery.isLoading && <p className="sk-state">Loading assignments…</p>}
          {assignmentsQuery.error && <p className="sk-state err">{(assignmentsQuery.error as Error).message}</p>}
          {classSectionId &&
            !assignmentsQuery.isLoading &&
            !assignmentsQuery.error &&
            upcoming.length === 0 &&
            past.length === 0 && <p className="sk-state">No assignments for this class yet.</p>}

          {[
            { label: 'Upcoming', rows: upcoming, tone: 'info' as const },
            { label: 'Past', rows: past, tone: undefined },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <div key={group.label} style={{ marginBottom: 16 }}>
                <span className="sk-lab">{group.label}</span>
                <div style={{ marginTop: 8 }}>
                  {group.rows.map((a, i) => {
                    // Capped at 100 defensively: `seenCount` counts
                    // AssignmentSeen rows, and a student moved out of the
                    // section after opening the sheet can leave the numerator
                    // above the current roster. A bar past its own track would
                    // read as a rendering bug rather than as data.
                    const seenPct =
                      rosterSize > 0 ? Math.min(100, Math.round((a.seenCount / rosterSize) * 100)) : null;
                    return (
                      // THE PIN. A posted assignment is a thing the teacher
                      // wrote and stuck up, so it lands as a slip rather than
                      // appearing as a table row — `.sk-postit` + `.sk-pinin`,
                      // the same gesture the diary and the noticeboard use.
                      // Staggered by position so a list arrives as a sequence.
                      <div
                        className="sk-postit sk-pinin sk-in"
                        key={a.id}
                        data-testid={`assignment-${a.id}`}
                        style={{ animationDelay: `${i * 0.05}s` }}
                      >
                        <div className="pt">{a.title}</div>
                        <div className="pd">
                          {subjectLabel(a.subjectId)} · Due {formatDueDate(a.dueDate)} · {a.seenCount} seen
                          {rosterSize > 0 ? ` of ${rosterSize}` : ''}
                        </div>
                        {a.attachments.length > 0 && (
                          <div className="pd" style={{ marginTop: 4 }}>
                            {a.attachments.map((att) => (
                              <a
                                key={att.url}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ marginRight: 10 }}
                              >
                                {att.name}
                              </a>
                            ))}
                          </div>
                        )}
                        {/* THE SEEN BAR — the same fraction the line above
                            states, drawn. It FILLS to its real width (the ink
                            line gesture) because a bar that arrives already
                            full reads as a label, not as a count that is still
                            climbing. Purely a restatement, so it is hidden from
                            assistive tech and from reduced motion it simply
                            appears at the true width. */}
                        {seenPct !== null && (
                          <div className="sk-seenbar" aria-hidden="true">
                            <i className="sk-inkline" style={{ width: `${seenPct}%` }} />
                          </div>
                        )}
                        <div className="acts">
                          <span className="sk-pill" data-tone={group.tone}>
                            {group.label}
                          </span>
                          <span style={{ flex: 1 }} />
                          <button
                            type="button"
                            className="sk-btn sk-press"
                            onClick={() => setConfirmDeleteId(a.id)}
                            disabled={deletingId === a.id}
                          >
                            {deletingId === a.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          titleId="delete-assignment-title"
          title="Delete this assignment?"
          isPending={deleteMutation.isPending}
          confirmLabel="Yes, delete"
          pendingLabel="Deleting…"
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        >
          <p>
            {deletingTarget
              ? `"${deletingTarget.title}" will be removed and its attachments will no longer be reachable from here.`
              : 'This cannot be undone.'}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
