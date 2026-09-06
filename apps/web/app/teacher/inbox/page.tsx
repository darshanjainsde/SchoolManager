'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import type { MessageThreadRow, MessageThreadDetail, TeacherReplyInput } from '@skoolos/types';
import { MESSAGE_BODY_MAX } from '@skoolos/types';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/** A real timestamp read in the browser's local time — mirrors announcements' formatPostedAt. */
function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * One page, master/detail with `selectedThreadId` state — not a `[threadId]`
 * sub-route. A thread here has no shareable/bookmarkable meaning of its own (a
 * teacher lands on their inbox, not a deep link), and keeping it in one client
 * component lets a reply write straight back into the open thread's cache
 * without a route transition. The list is the master; selecting swaps to the
 * thread view (with a Back affordance on narrow screens).
 */
export default function TeacherInboxPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const threadsKey = ['t-messages'];
  const threadsQuery = useQuery({
    queryKey: threadsKey,
    enabled: !!host,
    // API returns threads ordered by lastMessageAt desc — newest on top
    // ("response at the top"). We render in the order received, no re-sort.
    queryFn: () => api.get<MessageThreadRow[]>('/manage/messages'),
  });
  const threads = threadsQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const detailKey = ['t-message-thread', selectedId];
  const detailQuery = useQuery({
    queryKey: detailKey,
    enabled: !!host && !!selectedId,
    // GET marks the student→teacher messages read server-side, so once it
    // settles the thread list's unread badge is stale — refresh it.
    queryFn: () => api.get<MessageThreadDetail>(`/manage/messages/${selectedId}`),
  });

  useEffect(() => {
    if (detailQuery.isSuccess) void qc.invalidateQueries({ queryKey: threadsKey });
    // threadsKey is a stable literal; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQuery.isSuccess, detailQuery.dataUpdatedAt]);

  const [body, setBody] = useState('');
  const trimmed = body.trim();

  const reply = useMutation({
    mutationFn: () => {
      const payload: TeacherReplyInput = { body: trimmed };
      return api.post<MessageThreadDetail>(`/manage/messages/${selectedId}`, payload);
    },
    // Server returns the whole thread back — write it straight into the detail
    // cache so the new message shows immediately, then refresh the list order.
    onSuccess: (detail) => {
      qc.setQueryData(detailKey, detail);
      void qc.invalidateQueries({ queryKey: threadsKey });
      setBody('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const messages = detailQuery.data?.messages ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep messages in true chronological order — a conversation reads
    // oldest→newest — and move the VIEWPORT to the newest one instead of
    // reversing the list. That is the brief's "response at the top": the
    // latest reply is visible on open without hunting.
    const el = bottomRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [messages.length, selectedId]);

  const selectedThread = threads.find((t) => t.id === selectedId) ?? detailQuery.data?.thread ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Inbox</h1>
        <p>Questions from your students. One thread per student and subject — newest reply on top.</p>
      </header>

      {selectedId === null ? (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Conversations</h3>
          </div>
          <div className="sk-card-b">
            {threadsQuery.isLoading && <p className="sk-state">Loading your messages…</p>}
            {threadsQuery.error && (
              <p className="sk-state err">{(threadsQuery.error as Error).message}</p>
            )}
            {!threadsQuery.isLoading && !threadsQuery.error && threads.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <MessageSquare className="h-9 w-9 text-[var(--sk-ink-3)]" aria-hidden="true" />
                <p className="sk-state">No messages yet. Students can reach you here once they ask a question.</p>
              </div>
            )}
            {!threadsQuery.isLoading &&
              !threadsQuery.error &&
              // A `.sk-row` button: name over subject-and-preview, `.sp`, then
              // the time and the unread count flush right. The avatar column
              // `.sk-mrow` put in front of the name bought nothing here (a
              // thread already says whose it is, in the line beside it) and
              // cost the row its spacer, so the timestamps stopped lining up.
              threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="sk-row sk-press"
                  style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid var(--sk-line)' }}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{t.studentName}</div>
                    <div className="meta">
                      {t.subjectName}
                      {t.lastMessagePreview ? ` · ${t.lastMessagePreview}` : ''}
                    </div>
                  </div>
                  <span className="sp" />
                  <span className="meta" style={{ whiteSpace: 'nowrap' }}>{formatSentAt(t.lastMessageAt)}</span>
                  {t.unreadCount > 0 && (
                    <span className="sk-pill" data-tone="info" aria-label={`${t.unreadCount} unread`}>
                      {t.unreadCount}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <div className="sk-card">
          <div className="sk-card-h sk-wrap-sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="sk-btn"
              onClick={() => setSelectedId(null)}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <h3>
              {selectedThread ? `${selectedThread.studentName} · ${selectedThread.subjectName}` : 'Thread'}
            </h3>
          </div>
          <div className="sk-card-b">
            {detailQuery.isLoading && <p className="sk-state">Loading conversation…</p>}
            {detailQuery.error && <p className="sk-state err">{(detailQuery.error as Error).message}</p>}
            {!detailQuery.isLoading && !detailQuery.error && (
              <div className="flex flex-col gap-2" style={{ maxHeight: 420, overflowY: 'auto' }}>
                {/* THE BUBBLES. Each one fades and rises in (`sk-wfade` — the
                    same "this content is new on the page" gesture the rest of
                    the portal uses), staggered down the thread so opening a
                    conversation reads as it arriving rather than as it being
                    already there. The rise is what makes a reply you just
                    sent visibly the newest thing without a "sent" label.

                    Keyed on the message id, so React only mounts — and so
                    only animates — a message that is genuinely new; a refetch
                    of the same thread does not replay the whole conversation. */}
                {messages.map((m, i) => (
                  <div
                    key={m.id}
                    className="sk-bub sk-wfade"
                    data-mine={m.senderRole === 'TEACHER' ? 'true' : 'false'}
                    style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
                  >
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    <div className="when">{formatSentAt(m.createdAt)}</div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}

            {!detailQuery.isLoading && !detailQuery.error && (
              <div className="space-y-1.5">
                <label htmlFor="reply-body" className="sk-lab">
                  Reply
                </label>
                {/* maxLength mirrors MESSAGE_BODY_MAX (the DTO's @Length upper
                    bound) so an over-long reply is stopped here, not by a
                    failed round-trip with the text still in the box. */}
                <Textarea
                  id="reply-body"
                  rows={3}
                  className={`${fieldCls} w-full`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={reply.isPending}
                  maxLength={MESSAGE_BODY_MAX}
                  placeholder="Write a reply…"
                />
                <div>
                  <button
                    type="button"
                    className="sk-btn"
                    data-variant="primary"
                    disabled={trimmed.length === 0 || reply.isPending}
                    onClick={() => reply.mutate()}
                  >
                    {reply.isPending ? 'Sending…' : 'Send reply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
