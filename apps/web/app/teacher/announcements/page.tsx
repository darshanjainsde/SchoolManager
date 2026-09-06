'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AnnouncementMine, MyClassSection } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ClassMultiSelect } from '@/components/teacher/ClassMultiSelect';
import { ConfirmDialog } from '@/components/teacher/ConfirmDialog';

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/** `POST /manage/announcements`'s payload — see `AnnouncementsService.create`. */
interface CreateAnnouncementPayload {
  title: string;
  body: string;
  classSectionIds: string[];
}

/** Mirrors `formatDateTime` in `RequestList.tsx` — a real timestamp, read in the browser's local time. */
function formatPostedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TeacherAnnouncementsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const mineQueryKey = ['t-ann-mine'];
  const mineQuery = useQuery({
    queryKey: mineQueryKey,
    enabled: !!host,
    queryFn: () => api.get<AnnouncementMine[]>('/manage/announcements/mine'),
  });
  const mine = mineQuery.data ?? [];

  const classesQuery = useQuery({
    queryKey: ['t-ann-classes'],
    enabled: !!host,
    queryFn: () => api.get<MyClassSection[]>('/manage/attendance/my-classes'),
  });

  // A TEACHER may only announce to sections they own — AnnouncementsService.create
  // rejects `covering: true` sections with a 403 CLASS_NOT_OWNED. Filtering here
  // too means a teacher is never offered a target the server will refuse.
  const allClasses = classesQuery.data ?? [];
  const ownedClasses = allClasses.filter((c) => !c.covering);
  const coveringCount = allClasses.length - ownedClasses.length;

  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const canSubmit = selected.length > 0 && trimmedTitle.length > 0 && trimmedBody.length > 0;

  const post = useMutation({
    mutationFn: () => {
      const payload: CreateAnnouncementPayload = {
        title: trimmedTitle,
        body: trimmedBody,
        classSectionIds: selected,
      };
      return api.post('/manage/announcements', payload);
    },
    onSuccess: () => {
      const n = selected.length;
      toast.success(`Posted to ${n} class${n === 1 ? '' : 'es'}`);
      setTitle('');
      setBody('');
      setSelected([]);
      void qc.invalidateQueries({ queryKey: mineQueryKey });
    },
    // The API returns a { code, message } envelope; surface message verbatim
    // — a CLASS_NOT_OWNED 403 must be readable, not swallowed.
    onError: (e: Error) => toast.error(e.message),
  });

  const classesReady = !classesQuery.isLoading && !classesQuery.error;

  // ── Edit / delete own posts ──────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEdit(a: AnnouncementMine) {
    setEditingId(a.id);
    setEditTitle(a.title);
    setEditBody(a.body);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  const trimmedEditTitle = editTitle.trim();
  const trimmedEditBody = editBody.trim();
  const canSaveEdit = trimmedEditTitle.length > 0 && trimmedEditBody.length > 0;

  const editMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/manage/announcements/${id}`, { title: trimmedEditTitle, body: trimmedEditBody }),
    onSuccess: () => {
      toast.success('Announcement updated');
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: mineQueryKey });
    },
    // Same { code, message } envelope as the post mutation above.
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/manage/announcements/${id}`),
    onSuccess: () => {
      toast.success('Announcement deleted');
      setConfirmDeleteId(null);
      void qc.invalidateQueries({ queryKey: mineQueryKey });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmDeleteId(null);
    },
  });

  const deletingId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null;
  const deletingTarget = mine.find((a) => a.id === confirmDeleteId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Announcements</h1>
        <p>Post a notice to one or more of your classes. Guardians of every targeted class are notified.</p>
      </header>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Send to</h3>
        </div>
        <div className="sk-card-b">
          {classesQuery.isLoading && <p className="sk-state">Loading your classes…</p>}
          {classesQuery.error && <p className="sk-state err">{(classesQuery.error as Error).message}</p>}
          {classesReady && ownedClasses.length === 0 && (
            <p className="sk-state">No classes assigned to you yet — ask your admin.</p>
          )}
          {classesReady && ownedClasses.length > 0 && (
            <>
              <ClassMultiSelect
                classes={ownedClasses}
                selected={selected}
                onChange={setSelected}
                disabled={post.isPending}
              />
              {coveringCount > 0 && (
                <p className="sk-muted" style={{ marginTop: 8 }}>
                  {coveringCount} class{coveringCount === 1 ? '' : 'es'} you&apos;re only covering today{' '}
                  {coveringCount === 1 ? "isn't" : "aren't"} shown — covering a class for a period doesn&apos;t
                  include the right to announce to it.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {classesReady && ownedClasses.length > 0 && (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Post announcement</h3>
          </div>
          <div className="sk-card-b">
            <div className="space-y-1.5">
              <label htmlFor="ann-title" className="sk-lab">
                Title
              </label>
              {/* maxLength mirrors CreateAnnouncementDto's @Length(1, 160). Without
                  it a teacher can paste a long title, hit Post, and only then be
                  told it was too long by a server round-trip. */}
              <Input
                id="ann-title"
                className={`${fieldCls} w-full`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={post.isPending}
                maxLength={160}
                placeholder="e.g. Chapter 4 comprehension"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ann-body" className="sk-lab">
                Details
              </label>
              {/* Mirrors @Length(1, 4000) on the body, same reasoning as the title. */}
              <Textarea
                id="ann-body"
                rows={4}
                className={`${fieldCls} w-full`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={post.isPending}
                maxLength={4000}
                placeholder="Add instructions, due date…"
              />
            </div>
            <div>
              <button
                type="button"
                className="sk-btn"
                data-variant="primary"
                disabled={!canSubmit || post.isPending}
                onClick={() => post.mutate()}
              >
                {post.isPending
                  ? 'Posting…'
                  : `Post to ${selected.length} class${selected.length === 1 ? '' : 'es'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Your recent posts</h3>
        </div>
        <div className="sk-card-b">
          {mineQuery.isLoading && <p className="sk-state">Loading your posts…</p>}
          {/* { code, message } envelope — surface message verbatim. */}
          {mineQuery.error && <p className="sk-state err">{(mineQuery.error as Error).message}</p>}
          {!mineQuery.isLoading && !mineQuery.error && mine.length === 0 && (
            <p className="sk-state">You haven&apos;t posted anything yet.</p>
          )}
          {/* One `.sk-row` per post: audience pill, title over body-and-time,
              spacer, then Edit/Delete flush right. `.sk-postit` is a block, so
              it dropped the spacer and pushed both buttons onto a third line —
              every row grew by a button-height and the actions stopped lining
              up down a single right edge. */}
          {!mineQuery.isLoading &&
            !mineQuery.error &&
            mine.map((a) =>
              editingId === a.id ? (
                <div className="sk-row" key={a.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <label htmlFor={`edit-title-${a.id}`} className="sk-lab">
                    Title
                  </label>
                  <Input
                    id={`edit-title-${a.id}`}
                    className={fieldCls}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={editMutation.isPending}
                    maxLength={160}
                  />
                  <label htmlFor={`edit-body-${a.id}`} className="sk-lab">
                    Details
                  </label>
                  <Textarea
                    id={`edit-body-${a.id}`}
                    rows={3}
                    className={fieldCls}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    disabled={editMutation.isPending}
                    maxLength={4000}
                  />
                  <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="sk-btn" onClick={cancelEdit} disabled={editMutation.isPending}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="sk-btn"
                      data-variant="primary"
                      disabled={!canSaveEdit || editMutation.isPending}
                      onClick={() => editMutation.mutate(a.id)}
                    >
                      {editMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="sk-row" key={a.id}>
                  <span className="sk-pill" data-tone="info">
                    {a.className ?? 'Whole school'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{a.title}</div>
                    <div className="meta">
                      {a.body} · {formatPostedAt(a.createdAt)}
                    </div>
                  </div>
                  <span className="sp" />
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    style={{ marginRight: 8 }}
                    onClick={() => startEdit(a)}
                    disabled={deletingId === a.id}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    onClick={() => setConfirmDeleteId(a.id)}
                    disabled={deletingId === a.id}
                  >
                    {deletingId === a.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              ),
            )}
        </div>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          titleId="delete-announcement-title"
          title="Delete this announcement?"
          isPending={deleteMutation.isPending}
          confirmLabel="Yes, delete"
          pendingLabel="Deleting…"
          onConfirm={() => deleteMutation.mutate(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        >
          <p>
            {deletingTarget
              ? `"${deletingTarget.title}" will be removed for everyone it was sent to.`
              : 'This cannot be undone.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
