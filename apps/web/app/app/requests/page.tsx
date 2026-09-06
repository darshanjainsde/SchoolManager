'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RegisterChangeRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveType = 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID' | 'OTHER';

/**
 * `GET /manage/leave?status=PENDING` — the raw Prisma row spread plus a
 * server-joined `teacherName` (see LeaveService.list). Dates arrive as ISO
 * strings over the wire even though the API types them as Date.
 */
interface PendingLeave {
  id: string;
  teacherId: string;
  teacherName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  createdAt: string;
}

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  SICK: 'Sick leave',
  CASUAL: 'Casual leave',
  EARNED: 'Earned leave',
  UNPAID: 'Unpaid leave',
  OTHER: 'Other',
};

/**
 * One inbox item, whichever desk it came from. A single merged list (rather
 * than two stacked sections) mirrors the teacher-side /teacher/requests page
 * and matches how an admin actually triages: newest thing first, whatever it
 * is — the kind pill carries the distinction.
 */
interface DeskItem {
  kind: 'leave' | 'register';
  id: string;
  teacher: string;
  detail: string;
  reason: string | null;
  createdAt: string;
}

// UTC-anchored, matching the API's `@db.Date` columns — never shifts with the
// browser's local timezone (same helper as /app/leave).
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function toLeaveItem(a: PendingLeave): DeskItem {
  return {
    kind: 'leave',
    id: a.id,
    teacher: a.teacherName,
    detail: `${LEAVE_TYPE_LABEL[a.type] ?? a.type} · ${formatDate(a.startDate)} – ${formatDate(a.endDate)}`,
    reason: a.reason,
    createdAt: a.createdAt,
  };
}

function toRegisterItem(r: RegisterChangeRow): DeskItem {
  return {
    kind: 'register',
    id: r.id,
    teacher: r.requestedByName ?? 'Unknown teacher',
    detail: `${r.className} register · ${formatDate(r.date)}`,
    reason: r.reason,
    createdAt: r.createdAt,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminRequestsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  // `${kind}-${id}` of the row whose Reject is awaiting confirmation.
  const [confirmRejectKey, setConfirmRejectKey] = useState<string | null>(null);

  // `${kind}-${id}` → the outcome the admin just chose, for the cards still on
  // screen while the desk refetches. Purely presentational: it exists so the
  // stamp has something to land on at the moment of the decision, and it is
  // discarded the instant the refetch drops the card. The toast and the
  // refreshed list remain the actual record of what happened, so a
  // reduced-motion user (who sees the stamp printed, not landing) and a user
  // whose refetch returns instantly (who may not see it at all) both lose
  // nothing.
  const [decided, setDecided] = useState<Record<string, 'approved' | 'rejected'>>({});

  // Same key + endpoint as /app/leave's pending card, so the two pages share
  // one cache entry and either page's mutations keep the other fresh.
  const leaveQuery = useQuery({
    queryKey: ['a-leave-pending'],
    enabled: !!host,
    queryFn: () => api.get<PendingLeave[]>('/manage/leave?status=PENDING'),
  });

  const registerQuery = useQuery({
    queryKey: ['a-register-pending'],
    enabled: !!host,
    queryFn: () => api.get<RegisterChangeRow[]>('/manage/register-changes'),
  });

  function invalidateFor(kind: DeskItem['kind']) {
    if (kind === 'leave') {
      void qc.invalidateQueries({ queryKey: ['a-leave-pending'] });
      // /app/leave's other cards, if that page is also mounted or cached.
      void qc.invalidateQueries({ queryKey: ['a-leave-approved'] });
      void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
    } else {
      void qc.invalidateQueries({ queryKey: ['a-register-pending'] });
    }
  }

  const approve = useMutation({
    mutationFn: (item: DeskItem) =>
      api.post(
        item.kind === 'leave'
          ? `/manage/leave/${item.id}/approve`
          : `/manage/register-changes/${item.id}/approve`,
      ),
    onSuccess: (result, item) => {
      setDecided((d) => ({ ...d, [`${item.kind}-${item.id}`]: 'approved' }));
      if (item.kind === 'leave') {
        const gaps = (result as { gaps?: number }).gaps ?? 0;
        toast.success(
          gaps > 0
            ? `Approved — ${gaps} coverage ${gaps === 1 ? 'gap needs' : 'gaps need'} a substitute. See the Leave page.`
            : 'Approved — no scheduled classes to cover on those dates.',
        );
      } else {
        toast.success('Approved — the register is unlocked until the end of the day.');
      }
      invalidateFor(item.kind);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (item: DeskItem) =>
      api.post(
        item.kind === 'leave'
          ? `/manage/leave/${item.id}/reject`
          : `/manage/register-changes/${item.id}/reject`,
      ),
    onSuccess: (_result, item) => {
      setDecided((d) => ({ ...d, [`${item.kind}-${item.id}`]: 'rejected' }));
      toast.success('Request rejected.');
      setConfirmRejectKey(null);
      invalidateFor(item.kind);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmRejectKey(null);
    },
  });

  const isLoading = leaveQuery.isLoading || registerQuery.isLoading;
  // Settled with at least one side loaded — the difference between "nothing
  // loaded, don't claim an empty desk" and "show what did load next to the
  // failure" (same reasoning as /teacher/requests).
  const anyData = leaveQuery.data !== undefined || registerQuery.data !== undefined;
  const bothLoaded = leaveQuery.data !== undefined && registerQuery.data !== undefined;
  const errorMessages = [
    ...new Set([leaveQuery.error, registerQuery.error].filter(Boolean).map((e) => (e as Error).message)),
  ];

  const items: DeskItem[] = [
    ...(leaveQuery.data ?? []).map(toLeaveItem),
    ...(registerQuery.data ?? []).map(toRegisterItem),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const busy = approve.isPending || reject.isPending;

  return (
    <>
      <header className="sk-pagehead">
        <h1>Requests desk</h1>
        <p>
          Teacher leave and register-change requests, in one inbox.
          {bothLoaded ? ` ${items.length} pending.` : ''}
        </p>
      </header>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Pending requests</h3>
        </div>
        <div className="sk-card-b">
          {isLoading && <p className="sk-state">Loading requests…</p>}
          {!isLoading &&
            errorMessages.map((msg) => (
              <p className="sk-state err" key={msg}>
                {msg}
              </p>
            ))}
          {!isLoading && anyData && items.length === 0 && errorMessages.length === 0 && (
            <p className="sk-state">No pending requests — a quiet desk.</p>
          )}

          {!isLoading &&
            items.map((item) => {
              const key = `${item.kind}-${item.id}`;
              const confirming = confirmRejectKey === key;
              const outcome = decided[key];
              return (
                <div
                  className="sk-row sk-reqcard"
                  key={key}
                  data-decided={outcome ? 'true' : undefined}
                  style={{ alignItems: 'flex-start' }}
                >
                  <span className="sk-pill" data-tone={item.kind === 'leave' ? 'info' : 'warn'}>
                    {item.kind === 'leave' ? 'Leave' : 'Register change'}
                  </span>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div className="nm">{item.teacher}</div>
                    <div className="meta">
                      {item.detail}
                      {item.reason ? ` · ${item.reason}` : ''}
                    </div>
                    <div className="meta">Requested {formatDate(item.createdAt)}</div>
                  </div>
                  <span className="sp" />

                  {/* THE STAMP.
                      Undecided: an amber PENDING, printed flat. It is a state
                      the slip arrived in — nobody at this desk did it — so it
                      gets no gesture; stamping every row on page load would be
                      theatre, and the shared vocabulary reserves a landing
                      stamp for a terminal state.
                      Decided: green APPROVED / red REJECTED, landing with
                      `sk-stampin` at the instant the admin's own decision is
                      accepted by the API. That downstroke IS the gesture of
                      approving — it is the one moment on this page where a
                      person committed to something, and it reads as closed in
                      a way a toast that slides away does not. The card then
                      leaves the desk on the next refetch. */}
                  <span
                    className={outcome ? 'sk-reqstamp sk-stampin sk-in' : 'sk-reqstamp'}
                    data-state={outcome ?? 'pending'}
                    aria-hidden="true"
                  >
                    {outcome === 'approved' ? 'APPROVED' : outcome === 'rejected' ? 'REJECTED' : 'PENDING'}
                  </span>

                  {/* The actions take a line of their own (flex-basis 100%),
                      below the request, so the stamp above can never land on
                      top of a control. */}
                  {confirming ? (
                    <div
                      style={{
                        flexBasis: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 6,
                      }}
                    >
                      <span className="meta">Reject this request?</span>
                      <button
                        type="button"
                        className="sk-btn sk-press"
                        disabled={reject.isPending}
                        onClick={() => reject.mutate(item)}
                      >
                        Confirm reject
                      </button>
                      <button
                        type="button"
                        className="sk-btn sk-press"
                        disabled={reject.isPending}
                        onClick={() => setConfirmRejectKey(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="sk-wrap-sm" style={{ flexBasis: '100%', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        type="button"
                        className="sk-btn sk-press"
                        data-variant="primary"
                        disabled={busy}
                        onClick={() => approve.mutate(item)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="sk-btn sk-press"
                        disabled={busy}
                        onClick={() => setConfirmRejectKey(key)}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}
