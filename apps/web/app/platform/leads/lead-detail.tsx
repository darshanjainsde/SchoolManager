'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  CalendarClock,
  Copy,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import {
  ACTIVITY_KINDS,
  ACTIVITY_LABEL,
  LEAD_STAGES,
  STAGE_LABEL,
  dialable,
  formatDateTime,
  relativeTime,
  toDateTimeLocal,
  whatsappNumber,
  type ActivityKind,
  type LeadDetail,
  type LeadStage,
} from '../_lib/leads';

const KIND_ICON: Record<ActivityKind | 'STAGE_CHANGE', typeof Phone> = {
  NOTE: StickyNote,
  CALL: Phone,
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
  MEETING: Users,
  STAGE_CHANGE: ArrowRight,
};

/**
 * Right-hand drawer for one lead: contact shortcuts, the stage stepper, the
 * follow-up date and the activity timeline with its composer. Everything the
 * owner needs to work a lead lives here, so the board stays scannable.
 */
export function LeadDetailDrawer({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);

  const lead = useQuery({
    queryKey: ['owner-lead', leadId],
    queryFn: () => api.get<LeadDetail>(`/owner/leads/${leadId}`),
  });

  // Every mutation refreshes this lead, the board behind it, and the counters.
  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['owner-lead', leadId] });
    void qc.invalidateQueries({ queryKey: ['owner-leads'] });
    void qc.invalidateQueries({ queryKey: ['owner-overview'] });
  }

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/owner/leads/${leadId}`, body),
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });

  const logActivity = useMutation({
    mutationFn: (body: { kind: ActivityKind; body?: string }) =>
      api.post(`/owner/leads/${leadId}/activities`, body),
    onSuccess: () => {
      toast.success('Logged');
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Close on Escape, and lock the page behind the drawer.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const data = lead.data;

  return (
    <>
      <button type="button" className="sk-detail-scrim" aria-label="Close lead" onClick={onClose} />
      <div
        ref={panelRef}
        className="sk-own-detail skosx"
        role="dialog"
        aria-modal="true"
        aria-label="Lead detail"
        tabIndex={-1}
      >
        <div className="sk-detail-h">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 780, letterSpacing: '-0.02em' }}>
              {data?.name ?? (lead.isLoading ? 'Loading…' : 'Unnamed lead')}
            </div>
            {data && (
              <div className="sk-muted" style={{ fontSize: 12 }}>
                {data.school ?? 'No school given'} · came in {relativeTime(data.createdAt)} · via {data.source}
              </div>
            )}
          </div>
          <button type="button" className="sk-drawer-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="sk-detail-b">
          {lead.isLoading && <p className="sk-state">Loading lead…</p>}
          {lead.error && <p className="sk-state err">{(lead.error as Error).message}</p>}

          {data && (
            <>
              <ContactBlock lead={data} />

              <section className="sk-detail-sec">
                <div className="sk-lab">Stage</div>
                <div className="sk-own-stages">
                  {/* A lead still on the pre-pipeline CLOSED shows it here as
                      current-but-unreachable; picking any real stage moves it
                      off for good. */}
                  {!LEAD_STAGES.includes(data.status as (typeof LEAD_STAGES)[number]) && (
                    <button type="button" aria-current disabled>
                      {STAGE_LABEL[data.status]}
                    </button>
                  )}
                  {LEAD_STAGES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-current={s === data.status}
                      disabled={patch.isPending}
                      onClick={() => {
                        if (s === data.status) return;
                        patch.mutate({ status: s }, { onSuccess: () => toast.success(`Moved to ${STAGE_LABEL[s]}`) });
                      }}
                    >
                      {STAGE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </section>

              <FollowUpBlock lead={data} onSave={(v) => patch.mutate({ nextFollowUpAt: v })} saving={patch.isPending} />

              <ActivityComposer onLog={(kind, body) => logActivity.mutate({ kind, body })} pending={logActivity.isPending} />

              <section className="sk-detail-sec">
                <div className="sk-lab">History</div>
                {data.activities.length === 0 ? (
                  <p className="sk-muted" style={{ fontSize: 12.5 }}>
                    Nothing logged yet. Log the first call above and it will show up here.
                  </p>
                ) : (
                  <div className="sk-own-timeline">
                    {[...data.activities].reverse().map((a) => {
                      const Icon = KIND_ICON[a.kind] ?? StickyNote;
                      return (
                        <div key={a.id} className="sk-own-tl">
                          <span className="ic">
                            <Icon aria-hidden="true" />
                          </span>
                          <div className="bd">
                            <div className="hd">
                              {a.kind === 'STAGE_CHANGE'
                                ? `${a.fromStatus ? STAGE_LABEL[a.fromStatus as LeadStage] : '—'} → ${
                                    a.toStatus ? STAGE_LABEL[a.toStatus as LeadStage] : '—'
                                  }`
                                : ACTIVITY_LABEL[a.kind]}
                            </div>
                            {a.body && <div className="tx">{a.body}</div>}
                            <div className="tm" title={formatDateTime(a.createdAt)}>
                              {relativeTime(a.createdAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Blocks ─────────────────────────────────────────────────────────────────

function ContactBlock({ lead }: { lead: LeadDetail }) {
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access');
    }
  }

  return (
    <section className="sk-detail-sec">
      <div className="sk-lab">Contact</div>
      <div className="sk-card">
        <div className="sk-card-b" style={{ gap: 8 }}>
          <Row label="Phone" value={lead.phone} onCopy={() => copy(lead.phone, 'Phone number')} />
          {lead.email && <Row label="Email" value={lead.email} onCopy={() => copy(lead.email!, 'Email')} />}
          {lead.interest && <Row label="Interested in" value={lead.interest} />}
          <Row label="Last contacted" value={lead.lastContactedAt ? relativeTime(lead.lastContactedAt) : 'Never'} />
        </div>
      </div>
      <div className="sk-own-quick">
        <a href={`tel:${dialable(lead.phone)}`}>
          <Phone /> Call
        </a>
        <a href={`https://wa.me/${whatsappNumber(lead.phone)}`} target="_blank" rel="noreferrer">
          <MessageCircle /> WhatsApp
        </a>
        {lead.email && (
          <a href={`mailto:${lead.email}`}>
            <Mail /> Email
          </a>
        )}
      </div>
    </section>
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span className="sk-muted" style={{ minWidth: 106, fontSize: 12 }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          style={{ marginLeft: 'auto', border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--sk-ink-3)' }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function FollowUpBlock({
  lead,
  onSave,
  saving,
}: {
  lead: LeadDetail;
  onSave: (value: string | null) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(toDateTimeLocal(lead.nextFollowUpAt));

  // Re-sync when the server value changes (another save, or a different lead).
  useEffect(() => {
    setValue(toDateTimeLocal(lead.nextFollowUpAt));
  }, [lead.nextFollowUpAt]);

  const dirty = value !== toDateTimeLocal(lead.nextFollowUpAt);

  /** `datetime-local` gives local wall-clock time; the API wants a real instant. */
  function save() {
    onSave(value ? new Date(value).toISOString() : null);
  }

  return (
    <section className="sk-detail-sec">
      <div className="sk-lab">Next follow-up</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="datetime-local"
          className="sk-input"
          style={{ flex: 1, minWidth: 190 }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Next follow-up date and time"
        />
        <button className="sk-btn" data-variant="primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {lead.nextFollowUpAt && (
          <button className="sk-btn" onClick={() => onSave(null)} disabled={saving}>
            Clear
          </button>
        )}
      </div>
      {lead.nextFollowUpAt && !dirty && (
        <p className="sk-muted" style={{ fontSize: 12 }}>
          <CalendarClock className="inline h-3.5 w-3.5" /> Due {relativeTime(lead.nextFollowUpAt)} —{' '}
          {formatDateTime(lead.nextFollowUpAt)}
        </p>
      )}
    </section>
  );
}

function ActivityComposer({
  onLog,
  pending,
}: {
  onLog: (kind: ActivityKind, body?: string) => void;
  pending: boolean;
}) {
  const [kind, setKind] = useState<ActivityKind>('CALL');
  const [body, setBody] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onLog(kind, body.trim() || undefined);
    setBody('');
  }

  return (
    <section className="sk-detail-sec">
      <div className="sk-lab">Log what happened</div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="sk-own-seg" role="group" aria-label="Activity type">
          {ACTIVITY_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {ACTIVITY_LABEL[k]}
            </button>
          ))}
        </div>
        <textarea
          className="sk-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What was said? Anything to remember for next time?"
          aria-label="Activity note"
        />
        <button className="sk-btn" data-variant="primary" type="submit" disabled={pending}>
          <MessageSquare className="h-4 w-4" /> {pending ? 'Logging…' : `Log ${ACTIVITY_LABEL[kind].toLowerCase()}`}
        </button>
      </form>
    </section>
  );
}
