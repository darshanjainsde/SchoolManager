'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, FileText, Truck } from 'lucide-react';
import type { PrintOrderDetail, PrintOrderEventRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { rupees } from '@/lib/fees';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, pressDateLabel, specLabel } from '@/lib/press';
import { reserveTab, sendTabTo, dropTab, type OpenedTab } from './open-file';

/**
 * One print order — the school's copy of the ledger page.
 *
 * The timeline IS the event log the API keeps: every move either side makes
 * lands here with who and when. The one decision that belongs to the school —
 * confirming a quote — sits in its own card, price and date in large type,
 * because that is the moment money is being agreed to.
 */

const EVENT_LINE: Record<string, string> = {
  REQUESTED: 'Order placed',
  QUOTED: 'Sckools quoted',
  CONFIRMED: 'Confirmed — printing can begin',
  DECLINED: 'Sckools declined',
  CANCELLED: 'Cancelled',
  PRINTING: 'On the press',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
};

function eventDetail(e: PrintOrderEventRow): string | null {
  if (e.action === 'QUOTED' && e.data?.priceMinor != null) {
    return `${rupees(Number(e.data.priceMinor))} · by ${pressDateLabel(String(e.data.promisedBy))}`;
  }
  if (e.action === 'DISPATCHED' && e.data?.courier) {
    return `${String(e.data.courier)}${e.data.ref ? ` · ${String(e.data.ref)}` : ''}`;
  }
  return null;
}

export default function PressOrderPage() {
  const { id } = useParams<{ id: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const order = useQuery({
    queryKey: ['press-order', host, id], enabled: !!host,
    queryFn: () => api.get<PrintOrderDetail>(`/manage/press/orders/${id}`),
    // While the press is at work the page keeps itself honest.
    refetchInterval: (q) =>
      q.state.data && ['REQUESTED', 'CONFIRMED', 'PRINTING', 'DISPATCHED'].includes(q.state.data.status) ? 30_000 : false,
  });

  const move = useMutation({
    mutationFn: (path: 'confirm' | 'cancel') =>
      api.post<PrintOrderDetail>(`/manage/press/orders/${id}/${path}`,
        path === 'cancel' && cancelNote.trim() ? { note: cancelNote.trim() } : {}),
    onSuccess: (_d, path) => {
      qc.invalidateQueries({ queryKey: ['press-order', host, id] });
      qc.invalidateQueries({ queryKey: ['press-orders', host] });
      setCancelling(false);
      toast.success(path === 'confirm' ? 'Confirmed — Sckools starts printing.' : 'Order cancelled.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'That did not go through.'),
  });

  const o = order.data;

  /**
   * Open the PDF the school sent.
   *
   * A link rather than a stored URL: the server mints a presigned one per
   * request and the order payload deliberately never carries the storage key.
   * It is short-lived, so fetching on click — instead of on page load — means
   * the link cannot expire while somebody reads the page.
   *
   * `window.open` is called BEFORE the await and filled in afterwards. Opening
   * a tab inside a promise callback loses the user-gesture the popup blocker
   * checks for, and the file silently never appears.
   */
  // window.open, narrowed to what open-file needs.
  const openWindow = (url: string, target: string, features?: string) =>
    window.open(url, target, features) as unknown as OpenedTab | null;

  const viewFile = useMutation({
    mutationFn: () => api.get<{ url: string; filename: string }>(`/manage/press/orders/${id}/file`),
    // Reserved during the click, navigated once the link is signed — see
    // open-file.ts for why the reservation carries no `noopener`.
    onMutate: () => ({ tab: reserveTab(openWindow) }),
    onSuccess: (res, _v, ctx) => sendTabTo(ctx?.tab, res.url, openWindow),
    onError: (e: Error, _v, ctx) => {
      dropTab(ctx?.tab);
      toast.error(e.message);
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/app/press/orders" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <ArrowLeft size={13} aria-hidden="true" /> Print Store
      </Link>

      {order.isLoading && <p className="sk-state">Opening the order…</p>}
      {order.isError && (
        <p className="sk-state err">
          {order.error instanceof ApiError && order.error.status === 404
            ? 'That order was not found.'
            : 'The order could not load. Refresh to try again.'}
        </p>
      )}

      {o && (
        <>
          <header className="sk-pagehead">
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {o.title}
              <span className="sk-pill" data-tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</span>
            </h1>
            <p>
              {o.quantity} {o.quantity === 1 ? 'copy' : 'copies'} · {specLabel(o.spec)}
              {o.source.kind === 'REPORT_CARDS'
                ? ` · ${o.source.issuedCount} cards, serials ${o.source.serialFrom} – ${o.source.serialTo}`
                : ''}
              {o.neededBy && ` · needed by ${pressDateLabel(o.neededBy)}`}
            </p>
          </header>

          {/* ── What is actually being printed ────────────────────────────
              The school could see a filename and nothing else, then be asked to
              approve a paid run on trust. Checking the right document was
              attached is the one thing this page was missing. */}
          {o.source.kind === 'UPLOAD' && (
            <div className="sk-card"><div className="sk-card-b">
              <span className="sk-lab">What we will print</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <FileText size={20} aria-hidden="true" style={{ color: 'var(--sk-ink-3)', flex: 'none' }} />
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.source.filename}
                  </b>
                  <span className="sk-muted" style={{ fontSize: 11.5 }}>
                    {(o.source.bytes / 1024 / 1024).toFixed(1)} MB · sent to Sckools to print
                  </span>
                </span>
                <span style={{ flex: 1 }} />
                <button
                  className="sk-btn"
                  type="button"
                  disabled={viewFile.isPending}
                  onClick={() => viewFile.mutate()}
                >
                  {viewFile.isPending ? 'Opening…' : 'View the PDF'}
                </button>
              </div>
            </div></div>
          )}

          {/* ── The decision card ─────────────────────────────────────────── */}
          {o.status === 'QUOTED' && o.quote && (
            <div className="sk-card" style={{ borderColor: 'var(--sk-amber)' }}><div className="sk-card-b">
              <b style={{ fontSize: 13 }}>Sckools&rsquo; quote</b>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 26, fontWeight: 800 }}>{rupees(o.quote.priceMinor)}</span>
                <span className="sk-muted">delivered by <b style={{ color: 'var(--sk-ink)' }}>{pressDateLabel(o.quote.promisedBy)}</b></span>
              </div>
              {o.quote.note && <p className="sk-muted" style={{ fontSize: 12.5, margin: 0 }}>{o.quote.note}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="sk-btn" data-variant="primary" disabled={move.isPending} onClick={() => move.mutate('confirm')}>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  {move.isPending ? 'Confirming…' : 'Confirm & print'}
                </button>
                <button className="sk-btn" disabled={move.isPending} onClick={() => setCancelling(true)}>
                  Turn it down
                </button>
              </div>
              <p className="sk-muted" style={{ fontSize: 11.5, margin: 0 }}>
                Confirming locks this price and this date — both stay on the record below.
              </p>
            </div></div>
          )}

          {o.status === 'REQUESTED' && (
            <div className="sk-card"><div className="sk-card-b">
              <p className="sk-state" style={{ margin: 0 }}>
                Sckools is pricing this — the quote appears right here, usually within a working day.
              </p>
              <button className="sk-btn" style={{ alignSelf: 'flex-start' }} disabled={move.isPending} onClick={() => setCancelling(true)}>
                Cancel the request
              </button>
            </div></div>
          )}

          {cancelling && (
            <div className="sk-card" style={{ borderColor: 'var(--sk-bad)' }}><div className="sk-card-b">
              <b style={{ fontSize: 13 }}>Cancel this order?</b>
              <input className="sk-input" maxLength={300} placeholder="Why? (optional — the press reads it)"
                value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
              <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8 }}>
                <button className="sk-btn" data-variant="danger" disabled={move.isPending} onClick={() => move.mutate('cancel')}>
                  {move.isPending ? 'Cancelling…' : 'Yes, cancel it'}
                </button>
                <button className="sk-btn" onClick={() => setCancelling(false)}>Keep the order</button>
              </div>
            </div></div>
          )}

          {/* ── The agreed record, once confirmed ─────────────────────────── */}
          {o.quote && ['CONFIRMED', 'PRINTING', 'DISPATCHED', 'DELIVERED'].includes(o.status) && (
            <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' }}>
              <div className="sk-kpi">
                <div className="lab">Agreed price</div>
                <div className="n">{rupees(o.quote.priceMinor)}</div>
                <div className="hint">payable on delivery</div>
              </div>
              <div className="sk-kpi">
                <div className="lab">Promised by</div>
                <div className="n" style={{ fontSize: 20 }}>{pressDateLabel(o.quote.promisedBy)}</div>
                <div className="hint">Sckools&rsquo; commitment, on the record</div>
              </div>
              <div className="sk-kpi">
                <div className="lab">Deliver to</div>
                <div className="n" style={{ fontSize: 15 }}>{o.deliverTo.schoolName}</div>
                <div className="hint">{o.deliverTo.address || 'address on file'}</div>
              </div>
            </div>
          )}

          {/* ── The timeline — the event log, verbatim ────────────────────── */}
          <div className="sk-card"><div className="sk-card-b">
            <b style={{ fontSize: 13 }}>The record</b>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {o.events.map((e, i) => (
                <li key={i} style={{ display: 'flex', gap: 12, paddingBottom: i === o.events.length - 1 ? 0 : 14, position: 'relative' }}>
                  <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, flex: 'none' }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: 99, marginTop: 4,
                      background: e.actor === 'SCKOOLS' ? 'var(--sk-brand)' : 'var(--sk-good)',
                    }} />
                    {i < o.events.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--sk-line)', marginTop: 3 }} />}
                  </span>
                  <div style={{ fontSize: 12.5, minWidth: 0 }}>
                    <b>{EVENT_LINE[e.action] ?? e.action}</b>
                    <span className="sk-muted"> · {e.actor === 'SCKOOLS' ? 'Sckools' : 'the school'} · {pressDateLabel(e.at)}</span>
                    {eventDetail(e) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--sk-ink-2)', marginTop: 2 }}>
                        {e.action === 'DISPATCHED' && <Truck size={13} aria-hidden="true" />}
                        {eventDetail(e)}
                      </div>
                    )}
                    {e.note && <div className="sk-muted" style={{ marginTop: 2 }}>&ldquo;{e.note}&rdquo;</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div></div>
        </>
      )}
    </div>
  );
}
