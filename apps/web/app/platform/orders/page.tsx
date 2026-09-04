'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Printer, Truck, Check, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import type { OperatorOrderArtifact, OperatorOrderCounts, OperatorOrderRow } from '@skoolos/types';
import { ORDER_STATUS_LABEL, pressDateLabel, specLabel } from '@/lib/press';
import { rupees } from '@/lib/fees';
import { queueTone, FILTERS } from './queue';

/**
 * The order desk — every school's print orders, one queue.
 *
 * Filters follow OUR next action, not the raw status: "Needs quote" is the
 * pile that earns money, "Late" is the pile that loses schools. Each card
 * carries the address block verbatim (it goes on the parcel), the school's
 * note, and exactly the actions its status allows — the API's transition map
 * refuses anything else, so the desk shows nothing it would refuse.
 *
 * The tab counts come from their own endpoint rather than from measuring this
 * page: the list stops at a ceiling, so counting what arrived would under-report
 * exactly when the desk is busiest.
 */

function QuoteForm({ orderId, initial, onDone }: {
  orderId: string;
  initial: { priceMinor: number; promisedBy: string } | null;
  onDone: () => void;
}) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const [price, setPrice] = useState(initial ? String(initial.priceMinor / 100) : '');
  const [promisedBy, setPromisedBy] = useState(initial ? initial.promisedBy.slice(0, 10) : '');
  const [note, setNote] = useState('');

  const quote = useMutation({
    mutationFn: () => api.post(`/owner/print-orders/${orderId}/quote`, {
      priceMinor: Math.round(Number(price) * 100),
      promisedBy,
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: () => { toast.success('Quote sent — the school confirms from its console.'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = Number(price) >= 1 && !!promisedBy && !quote.isPending;
  return (
    <>
      <label className="sk-own-field" style={{ width: 120 }}>
        <span>Price ₹</span>
        <input type="number" min={1} inputMode="numeric" value={price} placeholder="2400"
          onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="sk-own-field" style={{ width: 165 }}>
        <span>Delivered by</span>
        <input type="date" value={promisedBy} onChange={(e) => setPromisedBy(e.target.value)} />
      </label>
      <label className="sk-own-field grow">
        <span>Note — the school reads this</span>
        <input maxLength={300} value={note} placeholder="incl. delivery"
          onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="button" className="sk-own-btn" data-kind="primary" disabled={!ready}
        onClick={() => quote.mutate()}>
        {quote.isPending ? 'Sending…' : initial ? 'Send revised quote' : 'Send quote'}
      </button>
    </>
  );
}

function OrderCard({ o, refresh }: { o: OperatorOrderRow; refresh: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [courier, setCourier] = useState('');
  const [ref, setRef] = useState('');

  const move = useMutation({
    mutationFn: (input: { path: string; body?: object }) =>
      api.post(`/owner/print-orders/${o.id}/${input.path}`, input.body ?? {}),
    onSuccess: () => { toast.success('Done — the school sees it on its timeline.'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // An uploaded PDF opens through a short-lived private link, on demand only.
  const openUpload = useMutation({
    mutationFn: () => api.get<OperatorOrderArtifact>(`/owner/print-orders/${o.id}/artifact`),
    onSuccess: (a) => { if (a.kind === 'UPLOAD') window.open(a.url, '_blank', 'noopener,noreferrer'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const artifactReady = ['CONFIRMED', 'PRINTING', 'DISPATCHED', 'DELIVERED'].includes(o.status);
  const quoting = o.status === 'REQUESTED' || o.status === 'QUOTED';

  return (
    <article className="sk-own-order" data-tone={queueTone(o.status, o.daysLate)}>
      <div className="sk-own-order-top">
        <div style={{ minWidth: 0 }}>
          <h2 className="sk-own-order-title">
            {o.schoolName}
            {o.city && <span style={{ fontWeight: 400, color: 'var(--sk-ink-3)', fontSize: 12.5 }}>{o.city}</span>}
            <span className="sk-pill" data-tone={queueTone(o.status, null)}>{ORDER_STATUS_LABEL[o.status]}</span>
            {o.daysLate !== null && (
              <span className="sk-pill" data-tone="bad">
                {o.daysLate} {o.daysLate === 1 ? 'day' : 'days'} past our promise
              </span>
            )}
            {o.confidential && <span className="sk-pill" data-tone="neutral">confidential</span>}
          </h2>

          <p className="sk-own-order-spec">
            <b>{o.title}</b> · {o.quantity} {o.quantity === 1 ? 'copy' : 'copies'} · {specLabel(o.spec)}
          </p>
          <p className="sk-own-order-meta">
            {o.source.kind === 'REPORT_CARDS'
              ? `${o.source.issuedCount} issued cards · serials ${o.source.serialFrom} – ${o.source.serialTo}`
              : `${o.source.filename} · ${(o.source.bytes / 1024 / 1024).toFixed(1)} MB`}
            {o.neededBy && <> · school needs it by <b>{pressDateLabel(o.neededBy)}</b></>}
            {' '}· asked {pressDateLabel(o.createdAt)}
          </p>
          {o.orderNote && <p className="sk-own-order-note">{o.orderNote}</p>}
          {o.quote && (
            <p className="sk-own-order-meta" style={{ marginTop: 6 }}>
              Quoted <b>{rupees(o.quote.priceMinor)}</b> · promised by <b>{pressDateLabel(o.quote.promisedBy)}</b>
              {o.quote.note && <> · {o.quote.note}</>}
            </p>
          )}
        </div>

        {/* The parcel label — verbatim, ready to copy onto the package. */}
        <address className="sk-own-addr">
          <b>{o.deliverTo.schoolName}</b>
          {o.deliverTo.address
            ? <div>{o.deliverTo.address}</div>
            : <div className="none">no address on the school profile</div>}
          <div>{o.deliverTo.contactName}{o.deliverTo.phone && ` · ${o.deliverTo.phone}`}</div>
        </address>
      </div>

      {/* ── Actions the transition map allows from here ─────────────────── */}
      <div className="sk-own-acts">
        {quoting && !declining && <QuoteForm orderId={o.id}
          initial={o.quote ? { priceMinor: o.quote.priceMinor, promisedBy: o.quote.promisedBy } : null}
          onDone={refresh} />}

        {quoting && !declining && (
          <button type="button" className="sk-own-link" onClick={() => setDeclining(true)}>
            Decline this order…
          </button>
        )}

        {quoting && declining && (
          <>
            <label className="sk-own-field grow">
              <span>Why? The school reads this on its timeline</span>
              <input maxLength={300} autoFocus value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)} />
            </label>
            <button type="button" className="sk-own-btn" data-kind="danger"
              disabled={declineReason.trim().length < 3 || move.isPending}
              onClick={() => move.mutate({ path: 'decline', body: { reason: declineReason.trim() } })}>
              <X size={14} aria-hidden="true" /> Decline
            </button>
            <button type="button" className="sk-own-btn" data-kind="quiet" onClick={() => setDeclining(false)}>
              Keep it
            </button>
          </>
        )}

        {artifactReady && o.kind === 'REPORT_CARDS' && (
          <Link href={`/platform/orders/${o.id}/print`} className="sk-own-btn">
            <FileText size={14} aria-hidden="true" /> Open the sheets
          </Link>
        )}
        {artifactReady && o.kind === 'UPLOAD' && (
          <button type="button" className="sk-own-btn" disabled={openUpload.isPending}
            onClick={() => openUpload.mutate()}>
            <FileText size={14} aria-hidden="true" />
            {openUpload.isPending ? 'Unlocking…' : 'Open the PDF (15-min link)'}
          </button>
        )}
        {o.status === 'CONFIRMED' && (
          <button type="button" className="sk-own-btn" data-kind="primary" disabled={move.isPending}
            onClick={() => move.mutate({ path: 'printing' })}>
            <Printer size={14} aria-hidden="true" /> Start printing
          </button>
        )}
        {o.status === 'PRINTING' && (
          <>
            <label className="sk-own-field" style={{ width: 140 }}>
              <span>Courier</span>
              <input maxLength={60} value={courier} onChange={(e) => setCourier(e.target.value)} />
            </label>
            <label className="sk-own-field" style={{ width: 150 }}>
              <span>Tracking ref (optional)</span>
              <input maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
            <button type="button" className="sk-own-btn" data-kind="primary"
              disabled={courier.trim().length < 2 || move.isPending}
              onClick={() => move.mutate({ path: 'dispatch', body: { courier: courier.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) } })}>
              <Truck size={14} aria-hidden="true" /> Dispatched
            </button>
            <button type="button" className="sk-own-btn" disabled={move.isPending}
              onClick={() => move.mutate({ path: 'delivered' })}>
              Hand-delivered
            </button>
          </>
        )}
        {o.status === 'DISPATCHED' && (
          <button type="button" className="sk-own-btn" data-kind="good" disabled={move.isPending}
            onClick={() => move.mutate({ path: 'delivered' })}>
            <Check size={14} aria-hidden="true" /> Delivered
          </button>
        )}
      </div>
    </article>
  );
}

export default function OperatorOrdersPage() {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('REQUESTED');

  const orders = useQuery({
    queryKey: ['owner-print-orders', filter],
    queryFn: () => api.get<OperatorOrderRow[]>(`/owner/print-orders${filter ? `?status=${filter}` : ''}`),
    refetchInterval: 60_000,
  });
  const counts = useQuery({
    queryKey: ['owner-print-order-counts'],
    queryFn: () => api.get<OperatorOrderCounts>('/owner/print-orders/counts'),
    refetchInterval: 60_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['owner-print-orders'] });
    void qc.invalidateQueries({ queryKey: ['owner-print-order-counts'] });
  };

  const n = (key: string) =>
    key === '' ? counts.data?.total : counts.data?.byStatus[key] ?? 0;

  return (
    <>
      <header className="sk-own-head">
        <div>
          <h1>Print orders</h1>
          <p>
            Schools&rsquo; printing, fulfilled by us. Quote it, keep the promise, ship it — every move lands
            on the school&rsquo;s own timeline.
          </p>
        </div>
        {(counts.data?.late ?? 0) > 0 && (
          <span className="sk-pill" data-tone="bad" style={{ marginTop: 6 }}>
            {counts.data?.late} past our promise
          </span>
        )}
      </header>

      <div className="sk-own-tabs" role="tablist" aria-label="Order queue">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" className="sk-own-tab"
            aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            {counts.data && <span className="n" data-tone={f.key === 'REQUESTED' ? 'due' : undefined}>{n(f.key)}</span>}
          </button>
        ))}
      </div>

      {orders.isLoading && <p className="sk-own-state">Loading the queue…</p>}
      {orders.isError && (
        <p className="sk-own-state" data-tone="err">
          <b>The queue could not load.</b>
          Refresh to try again — nothing has been lost.
        </p>
      )}
      {orders.data?.length === 0 && (
        <p className="sk-own-state">
          <b>Nothing in this pile.</b>
          New requests land under <b style={{ display: 'inline' }}>Needs quote</b> the moment a school sends one.
        </p>
      )}

      {(orders.data ?? []).map((o) => <OrderCard key={o.id} o={o} refresh={refresh} />)}
    </>
  );
}
