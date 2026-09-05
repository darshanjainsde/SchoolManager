'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarClock,
  Download,
  Inbox,
  KanbanSquare,
  MessageCircle,
  Phone,
  Rows3,
  Search,
  Trophy,
  Users,
} from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';
import {
  DONE_STAGES,
  LEAD_STAGES,
  OPEN_STAGES,
  displayColumn,
  STAGE_HINT,
  STAGE_LABEL,
  dialable,
  downloadCsv,
  followUpTone,
  leadsToCsv,
  relativeTime,
  whatsappNumber,
  type Lead,
  type LeadStage,
} from '../_lib/leads';
import { LeadDetailDrawer } from './lead-detail';
import '../../sk-theme.css';

type View = 'board' | 'list';

/** Debounce keystrokes so a fast typist doesn't fire a request per character. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function LeadsPage() {
  // Session state, not the token itself — the refresh token is an HttpOnly
  // cookie the client cannot read.
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();

  const [view, setView] = useState<View>('board');
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 250);

  // The board wants every stage at once, so the stage split is done
  // client-side; only the search term round-trips to the server.
  const leads = useQuery({
    queryKey: ['owner-leads', debouncedSearch],
    queryFn: () =>
      api.get<Lead[]>(`/owner/leads${debouncedSearch ? `?q=${encodeURIComponent(debouncedSearch)}` : ''}`),
    enabled: signedIn,
  });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStage }) =>
      api.patch(`/owner/leads/${id}`, { status }),
    onSuccess: (_d, v) => {
      toast.success(`Moved to ${STAGE_LABEL[v.status]}`);
      void qc.invalidateQueries({ queryKey: ['owner-leads'] });
      void qc.invalidateQueries({ queryKey: ['owner-lead', v.id] });
      void qc.invalidateQueries({ queryKey: ['owner-overview'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const all = useMemo(() => leads.data ?? [], [leads.data]);

  const visible = useMemo(
    () => (dueOnly ? all.filter((l) => followUpTone(l.nextFollowUpAt, l.status) === 'due') : all),
    [all, dueOnly],
  );

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>(LEAD_STAGES.map((s) => [s, [] as Lead[]]));
    for (const lead of visible) map.get(displayColumn(lead.status))?.push(lead);
    return map;
  }, [visible]);

  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      fresh: all.filter((l) => l.status === 'NEW').length,
      working: all.filter((l) => OPEN_STAGES.includes(l.status)).length,
      due: all.filter((l) => followUpTone(l.nextFollowUpAt, l.status) === 'due').length,
      won: all.filter((l) => l.status === 'WON' && new Date(l.updatedAt) >= monthStart).length,
    };
  }, [all]);

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`sckools-leads-${stamp}.csv`, leadsToCsv(visible));
    toast.success(`Exported ${visible.length} lead${visible.length === 1 ? '' : 's'}`);
  }

  return (
    <div>
      <header
        className="sk-pagehead"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1>Leads</h1>
          <p>Everyone who asked for a callback on sckools.com — move them along and log every conversation.</p>
        </div>
        <button className="sk-btn" onClick={exportCsv} disabled={visible.length === 0}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </header>

      {/* Work summary — the four numbers that decide what to do next. */}
      <div className="sk-own-attention" style={{ marginBottom: 16 }}>
        <StatTile icon={<Inbox />} n={stats.fresh} title="New" sub="not contacted yet" urgent />
        <StatTile icon={<Users />} n={stats.working} title="In progress" sub="contacted → demo" />
        <StatTile
          icon={<CalendarClock />}
          n={stats.due}
          title="Follow-ups due"
          sub={stats.due > 0 ? 'overdue right now' : 'nothing overdue'}
          urgent
        />
        <StatTile icon={<Trophy />} n={stats.won} title="Won this month" sub="signed up" />
      </div>

      {/* Toolbar */}
      <div className="sk-toolbar" style={{ marginBottom: 14 }}>
        <div className="sk-own-search">
          <Search aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, school…"
            aria-label="Search leads"
          />
        </div>

        <div className="sk-own-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>
            <KanbanSquare className="h-4 w-4" /> Board
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <Rows3 className="h-4 w-4" /> List
          </button>
        </div>

        <button
          type="button"
          className="sk-btn"
          data-variant={dueOnly ? 'primary' : undefined}
          onClick={() => setDueOnly((v) => !v)}
          aria-pressed={dueOnly}
        >
          <CalendarClock className="h-4 w-4" /> Due only
        </button>
      </div>

      {/* Not `isLoading`: a query between retries is neither loading nor
          errored, and would render nothing at all. */}
      {!leads.data && !leads.error && <p className="sk-state">Loading leads…</p>}
      {leads.error && (
        <div className="sk-own-note" data-tone="warn">
          <span>
            Could not load leads — {(leads.error as Error).message}.{' '}
            <button
              type="button"
              onClick={() => void leads.refetch()}
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                       color: 'var(--sk-brand-2)', fontWeight: 640 }}
            >
              Try again
            </button>
          </span>
        </div>
      )}

      {leads.data && visible.length === 0 && (
        <div className="sk-card">
          <div className="sk-own-empty">
            <div className="ic">
              <Inbox className="h-5 w-5" />
            </div>
            <h4>{search || dueOnly ? 'Nothing matches' : 'No leads yet'}</h4>
            <p>
              {search || dueOnly
                ? 'Try a different search, or switch off the “due only” filter.'
                : 'Leads appear here the moment someone requests a callback on sckools.com.'}
            </p>
          </div>
        </div>
      )}

      {leads.data && visible.length > 0 && view === 'board' && (
        <div className="sk-own-board">
          {LEAD_STAGES.map((stage) => {
            const column = byStage.get(stage) ?? [];
            return (
              <section key={stage} className="sk-own-col" aria-label={STAGE_LABEL[stage]}>
                <div className="sk-col-h">
                  <span className="dot sk-own-stagedot" data-stage={stage} aria-hidden="true" />
                  <span className="t">{STAGE_LABEL[stage]}</span>
                  <span className="c">{column.length}</span>
                </div>
                <div className="sk-col-b">
                  {column.length === 0 && <p className="sk-col-empty">{STAGE_HINT[stage]}</p>}
                  {column.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      selected={openId === lead.id}
                      onOpen={() => setOpenId(lead.id)}
                      onMove={(status) => move.mutate({ id: lead.id, status })}
                      moving={move.isPending && move.variables?.id === lead.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {leads.data && visible.length > 0 && view === 'list' && (
        <LeadTable
          leads={visible}
          onOpen={setOpenId}
          onMove={(id, status) => move.mutate({ id, status })}
          movingId={move.isPending ? move.variables?.id : undefined}
        />
      )}

      {openId && <LeadDetailDrawer leadId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function StatTile({
  icon,
  n,
  title,
  sub,
  urgent,
}: {
  icon: React.ReactNode;
  n: number;
  title: string;
  sub: string;
  /** Only paints the warm "act on this" treatment when the count is non-zero. */
  urgent?: boolean;
}) {
  return (
    <div className="sk-own-attn" data-urgent={urgent && n > 0 ? 'true' : 'false'}>
      <span className="n">{n}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t">{title}</div>
        <div className="s">{sub}</div>
      </div>
      <span style={{ marginLeft: 'auto', opacity: 0.4 }} aria-hidden="true">
        {icon}
      </span>
    </div>
  );
}

/**
 * One card on the board. The stage control is a `<select>` rather than
 * drag-and-drop: it works on a phone, with a keyboard and with a screen
 * reader, none of which is true of a drag handle.
 */
function LeadCard({
  lead,
  selected,
  onOpen,
  onMove,
  moving,
}: {
  lead: Lead;
  selected: boolean;
  onOpen: () => void;
  onMove: (status: LeadStage) => void;
  moving: boolean;
}) {
  const tone = followUpTone(lead.nextFollowUpAt, lead.status);
  return (
    <div className="sk-own-lead" data-selected={selected} role="group">
      <button
        type="button"
        onClick={onOpen}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <span className="nm">{lead.name ?? 'Unnamed lead'}</span>
        <span className="meta">
          <span>{lead.phone}</span>
          {lead.school && <span>· {lead.school}</span>}
        </span>
        <span className="meta">Came in {relativeTime(lead.createdAt)}</span>
      </button>

      <div className="tags">
        {lead.interest && <span className="sk-own-tag">{lead.interest}</span>}
        {tone && (
          <span className="sk-own-tag" data-tone={tone}>
            {tone === 'due' ? 'Follow-up due' : 'Follow-up soon'}
          </span>
        )}
        {lead.activityCount > 0 && <span className="sk-own-tag">{lead.activityCount} logged</span>}
      </div>

      <div className="sk-own-quick">
        <a href={`tel:${dialable(lead.phone)}`} aria-label={`Call ${lead.name ?? lead.phone}`}>
          <Phone /> Call
        </a>
        <a
          href={`https://wa.me/${whatsappNumber(lead.phone)}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Message ${lead.name ?? lead.phone} on WhatsApp`}
        >
          <MessageCircle /> WhatsApp
        </a>
      </div>

      <select
        className="sk-input"
        style={{ padding: '6px 9px', fontSize: 12 }}
        value={lead.status}
        disabled={moving}
        onChange={(e) => onMove(e.target.value as LeadStage)}
        aria-label={`Stage for ${lead.name ?? lead.phone}`}
      >
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>
            {s === lead.status ? `● ${STAGE_LABEL[s]}` : `Move to ${STAGE_LABEL[s]}`}
          </option>
        ))}
        {/* Rendered only for a lead still carrying the pre-pipeline value, so
            the control shows what it actually is. Disabled: it is not somewhere
            you can put a lead, only somewhere one can still be. */}
        {!LEAD_STAGES.includes(lead.status as (typeof LEAD_STAGES)[number]) && (
          <option value={lead.status} disabled>
            ● {STAGE_LABEL[lead.status]}
          </option>
        )}
      </select>
    </div>
  );
}

function LeadTable({
  leads,
  onOpen,
  onMove,
  movingId,
}: {
  leads: Lead[];
  onOpen: (id: string) => void;
  onMove: (id: string, status: LeadStage) => void;
  movingId?: string;
}) {
  return (
    <div className="sk-own-tablewrap">
      <table className="sk-own-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Contact</th>
            <th>Interest</th>
            <th>Came in</th>
            <th>Follow-up</th>
            <th>Stage</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const tone = followUpTone(l.nextFollowUpAt, l.status);
            return (
              <tr key={l.id}>
                <td>
                  <button
                    type="button"
                    onClick={() => onOpen(l.id)}
                    style={{ all: 'unset', cursor: 'pointer', fontWeight: 650 }}
                  >
                    {l.name ?? 'Unnamed lead'}
                  </button>
                  {l.school && (
                    <div className="sk-muted" style={{ fontSize: 11.5 }}>
                      {l.school}
                    </div>
                  )}
                </td>
                <td>
                  <div className="sk-own-quick">
                    <a href={`tel:${dialable(l.phone)}`}>
                      <Phone /> {l.phone}
                    </a>
                  </div>
                </td>
                <td className="sk-muted">{l.interest ?? '—'}</td>
                <td className="sk-muted">{relativeTime(l.createdAt)}</td>
                <td>
                  {l.nextFollowUpAt ? (
                    <span className="sk-own-tag" data-tone={tone ?? undefined}>
                      {relativeTime(l.nextFollowUpAt)}
                    </span>
                  ) : (
                    <span className="sk-muted">—</span>
                  )}
                </td>
                <td>
                  <select
                    className="sk-input"
                    style={{ padding: '6px 9px', fontSize: 12, minWidth: 132 }}
                    value={l.status}
                    disabled={movingId === l.id}
                    onChange={(e) => onMove(l.id, e.target.value as LeadStage)}
                    aria-label={`Stage for ${l.name ?? l.phone}`}
                  >
                    {LEAD_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                    {!LEAD_STAGES.includes(l.status as (typeof LEAD_STAGES)[number]) && (
                      <option value={l.status} disabled>
                        {STAGE_LABEL[l.status]}
                      </option>
                    )}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
