'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MyClassSection } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ClassMultiSelect } from '@/components/teacher/ClassMultiSelect';

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/** `POST /manage/announcements`'s payload — see `AnnouncementsService.create`. */
interface CreateAnnouncementPayload {
  title: string;
  body: string;
  classSectionIds: string[];
}

export default function TeacherAnnouncementsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

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
    },
    // The API returns a { code, message } envelope; surface message verbatim
    // — a CLASS_NOT_OWNED 403 must be readable, not swallowed.
    onError: (e: Error) => toast.error(e.message),
  });

  const classesReady = !classesQuery.isLoading && !classesQuery.error;

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
          <h3>Recent</h3>
        </div>
        <div className="sk-card-b">
          {/* Teachers have no endpoint to list their own past announcements yet
              (GET /manage/announcements is SCHOOL_ADMIN-only) — say so plainly
              instead of shipping a panel that always 404s. */}
          <p className="sk-state">Posted notices aren&apos;t listed here yet.</p>
        </div>
      </div>
    </div>
  );
}
