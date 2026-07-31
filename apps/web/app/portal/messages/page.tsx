'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, MessageSquare, Plus } from 'lucide-react';
import type {
  MessageThreadRow,
  MessageThreadDetail,
  MessageableTeacher,
  StudentSendMessageInput,
} from '@skoolos/types';
import { MESSAGE_BODY_MAX } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent } from '@/components/ui/card';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Which panel is on screen. A single client component with a discriminated
 * `screen` state rather than sub-routes: a portal message thread has no
 * bookmarkable identity of its own, and keeping it here lets a send write the
 * returned thread straight into cache with no route transition.
 * - `list`    — existing threads (newest thread on top; API orders them).
 * - `pick`    — the teachers-who-teach-me picker (GET /me/messages/teachers).
 * - `thread`  — an existing thread opened for reading (GET /me/messages/:id).
 * - `compose` — a brand-new thread to a picked teacher+subject; the first send
 *               find-or-creates the thread server-side (POST /me/messages).
 */
type Screen =
  | { mode: 'list' }
  | { mode: 'pick' }
  | { mode: 'thread'; threadId: string }
  | { mode: 'compose'; target: MessageableTeacher };

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalMessagesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const threadsKey = ['portal-messages'];
  const threadsQuery = useQuery({
    queryKey: threadsKey,
    enabled: !!host,
    // Newest thread on top — the API already orders by lastMessageAt desc.
    queryFn: () => api.get<MessageThreadRow[]>('/me/messages'),
  });
  const threads = threadsQuery.data ?? [];

  const [screen, setScreen] = useState<Screen>({ mode: 'list' });

  // ── Teacher picker (only fetched when the picker is open) ────────────────
  const teachersQuery = useQuery({
    queryKey: ['portal-messageable-teachers'],
    enabled: !!host && screen.mode === 'pick',
    queryFn: () => api.get<MessageableTeacher[]>('/me/messages/teachers'),
  });
  const teachers = teachersQuery.data ?? [];

  // ── Open thread (existing) ───────────────────────────────────────────────
  const openThreadId = screen.mode === 'thread' ? screen.threadId : null;
  const detailKey = ['portal-message-thread', openThreadId];
  const detailQuery = useQuery({
    queryKey: detailKey,
    enabled: !!host && !!openThreadId,
    // GET marks teacher→student messages read server-side; refresh the list's
    // unread badge once it settles.
    queryFn: () => api.get<MessageThreadDetail>(`/me/messages/${openThreadId}`),
  });

  useEffect(() => {
    if (detailQuery.isSuccess) void qc.invalidateQueries({ queryKey: threadsKey });
    // threadsKey is a stable literal; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQuery.isSuccess, detailQuery.dataUpdatedAt]);

  // ── Composer (shared by 'thread' and 'compose') ──────────────────────────
  const [body, setBody] = useState('');
  const trimmed = body.trim();

  const send = useMutation({
    mutationFn: () => {
      if (screen.mode === 'compose') {
        const payload: StudentSendMessageInput = {
          teacherId: screen.target.teacherId,
          subjectId: screen.target.subjectId,
          body: trimmed,
        };
        return api.post<MessageThreadDetail>('/me/messages', payload);
      }
      // In an existing thread we still start a NEW message via POST /me/messages
      // keyed by the thread's teacher+subject — the server find-or-creates, so
      // this appends to the same thread.
      const t = detailQuery.data!.thread;
      const payload: StudentSendMessageInput = {
        teacherId: t.teacherId,
        subjectId: t.subjectId,
        body: trimmed,
      };
      return api.post<MessageThreadDetail>('/me/messages', payload);
    },
    onSuccess: (detail) => {
      qc.setQueryData(['portal-message-thread', detail.thread.id], detail);
      void qc.invalidateQueries({ queryKey: threadsKey });
      setBody('');
      // A compose becomes a normal open thread once it exists.
      setScreen({ mode: 'thread', threadId: detail.thread.id });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const messages = detailQuery.data?.messages ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Messages stay in true chronological order (oldest→newest, how a
    // conversation reads); we scroll the VIEWPORT to the newest one so the
    // latest reply is visible on open without hunting — the brief's "response
    // at the top".
    const el = bottomRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [messages.length, openThreadId]);

  function resetToList() {
    setBody('');
    setScreen({ mode: 'list' });
  }

  const composeTarget = screen.mode === 'compose' ? screen.target : null;
  const openThread =
    threads.find((t) => t.id === openThreadId) ?? detailQuery.data?.thread ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ask one of your teachers a question about a subject they teach you.
          </p>
        </div>
        {screen.mode === 'list' && (
          <button
            type="button"
            onClick={() => setScreen({ mode: 'pick' })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New message
          </button>
        )}
      </header>

      {/* ── LIST ──────────────────────────────────────────────────────────── */}
      {screen.mode === 'list' && (
        <>
          {threadsQuery.isLoading && <p className="text-sm text-slate-400">Loading messages…</p>}
          {threadsQuery.error && (
            <p className="text-sm text-rose-500">{(threadsQuery.error as Error).message}</p>
          )}
          {!threadsQuery.isLoading && !threadsQuery.error && threads.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <MessageSquare className="h-10 w-10 text-slate-300" aria-hidden="true" />
              <p className="text-sm text-slate-400">
                No messages yet. Tap &ldquo;New message&rdquo; to ask a teacher a question.
              </p>
            </div>
          )}
          {threads.length > 0 && (
            <ul className="flex flex-col gap-3">
              {threads.map((t) => (
                <li key={t.id}>
                  <Card>
                    <CardContent className="pt-4">
                      <button
                        type="button"
                        onClick={() => setScreen({ mode: 'thread', threadId: t.id })}
                        className="flex w-full items-start justify-between gap-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900">{t.teacherName}</p>
                          <p className="text-sm text-slate-600">{t.subjectName}</p>
                          {t.lastMessagePreview && (
                            <p className="mt-0.5 truncate text-xs text-slate-400">{t.lastMessagePreview}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="whitespace-nowrap text-xs text-slate-400">
                            {formatSentAt(t.lastMessageAt)}
                          </span>
                          {t.unreadCount > 0 && (
                            <span
                              className="inline-flex items-center rounded-full bg-teal-600 px-2 py-0.5 text-xs font-medium text-white"
                              aria-label={`${t.unreadCount} unread`}
                            >
                              {t.unreadCount}
                            </span>
                          )}
                        </div>
                      </button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── PICK A TEACHER ────────────────────────────────────────────────── */}
      {screen.mode === 'pick' && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={resetToList}
            className="inline-flex items-center gap-1.5 self-start text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
          <h2 className="text-sm font-semibold text-slate-700">Choose a teacher and subject</h2>
          {teachersQuery.isLoading && <p className="text-sm text-slate-400">Loading your teachers…</p>}
          {teachersQuery.error && (
            <p className="text-sm text-rose-500">{(teachersQuery.error as Error).message}</p>
          )}
          {!teachersQuery.isLoading && !teachersQuery.error && teachers.length === 0 && (
            <p className="text-sm text-slate-400">
              No teachers to message yet — your timetable has no subject teachers this week.
            </p>
          )}
          {teachers.map((t) => (
            <button
              key={`${t.teacherId}-${t.subjectId}`}
              type="button"
              onClick={() => setScreen({ mode: 'compose', target: t })}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-teal-500"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{t.teacherName}</p>
                <p className="text-sm text-slate-600">{t.subjectName}</p>
              </div>
              <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {/* ── THREAD (existing) or COMPOSE (new) ────────────────────────────── */}
      {(screen.mode === 'thread' || screen.mode === 'compose') && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={resetToList}
            className="inline-flex items-center gap-1.5 self-start text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>

          <div>
            <h2 className="font-semibold text-slate-900">
              {composeTarget ? composeTarget.teacherName : openThread?.teacherName ?? 'Teacher'}
            </h2>
            <p className="text-sm text-slate-600">
              {composeTarget ? composeTarget.subjectName : openThread?.subjectName ?? ''}
            </p>
          </div>

          {screen.mode === 'thread' && detailQuery.isLoading && (
            <p className="text-sm text-slate-400">Loading conversation…</p>
          )}
          {screen.mode === 'thread' && detailQuery.error && (
            <p className="text-sm text-rose-500">{(detailQuery.error as Error).message}</p>
          )}

          {screen.mode === 'compose' && (
            <p className="text-sm text-slate-400">Start the conversation below.</p>
          )}

          {screen.mode === 'thread' && !detailQuery.isLoading && !detailQuery.error && (
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.senderRole === 'STUDENT'
                      ? 'self-end bg-teal-600 text-white'
                      : 'self-start bg-slate-100 text-slate-800'
                  }`}
                >
                  <div>{m.body}</div>
                  <div
                    className={`mt-1 text-[11px] ${
                      m.senderRole === 'STUDENT' ? 'text-teal-100' : 'text-slate-400'
                    }`}
                  >
                    {formatSentAt(m.createdAt)}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Composer — maxLength mirrors MESSAGE_BODY_MAX so an over-long
              message is stopped here, not by a failed server round-trip. */}
          <div className="flex flex-col gap-2">
            <label htmlFor="message-body" className="sr-only">
              Your message
            </label>
            <textarea
              id="message-body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={send.isPending}
              maxLength={MESSAGE_BODY_MAX}
              placeholder="Type your question…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none disabled:opacity-60"
            />
            <div>
              <button
                type="button"
                onClick={() => send.mutate()}
                disabled={trimmed.length === 0 || send.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {send.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
