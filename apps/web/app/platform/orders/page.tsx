'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import type { OperatorOrderArtifact, OperatorOrderRow } from '@skoolos/types';
import { ORDER_STATUS_LABEL, pressDateLabel, specLabel } from '@/lib/press';
import { rupees } from '@/lib/fees';

/**
 * The order desk — every school's print orders, one queue.
 *
 * Filters follow OUR next action, not the raw status: "Needs quote" is the
 * pile that earns money, "Late" is the pile that loses schools. Each card
 * carries the address block verbatim (it goes on the parcel), the school's
 * note, and exactly the actions its status allows — the API's transition map
 * refuses anything else, so the desk shows nothing it would refuse.
 */

const FILTERS = [
  { key: 'REQUESTED', label: 'Needs quote' },
  { key: 'QUOTED', label: 'Awaiting school' },
  { key: 'CONFIRMED', label: 'To print' },
  { key: 'PRINTING', label: 'On the press' },
  { key: 'DISPATCHED', label: 'Dispatched' },
  { key: '', label: 'Everything' },
] as const;

const STATUS_BADGE: Record<string, string> = {
  REQUESTED: 'bg-blue-100 text-blue-700',
  QUOTED: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  PRINTING: 'bg-indigo-100 text-indigo-700',
  DISPATCHED: 'bg-sky-100 text-sky-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  DECLINED: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

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
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
        Price (₹, whole order)
        <input type="number" min={1} className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={price} onChange={(e) => setPrice(e.target.value)} placeholder="2400" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
        Delivered by — this is the promise we log
        <input type="date" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={promisedBy} onChange={(e) => setPromisedBy(e.target.value)} />
      </label>
      <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-semibold text-slate-600">
        Note (optional)
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" maxLength={300}
          value={note} onChange={(e) => setNote(e.target.value)} placeholder="incl. delivery" />
      </label>
      <button type="button" disabled={!ready} onClick={() => quote.mutate()}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {quote.isPending ? 'Sending…' : initial ? 'Send revised quote' : 'Send quote'}
      </button>
    </div>
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
    onSuccess: (a) => { if (a.kind === 'UPLOAD') window.open(a.url, '_blank', 'noopener'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const artifactReady = ['CONFIRMED', 'PRINTING', 'DISPATCHED', 'DELIVERED'].includes(o.status);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{o.schoolName}</span>
            {o.city && <span className="text-xs text-slate-500">{o.city}</span>}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[o.status]}`}>
              {ORDER_STATUS_LABEL[o.status]}
            </span>
            {o.daysLate !== null && (
              <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                {o.daysLate} {o.daysLate === 1 ? 'day' : 'days'} past our promise
              </span>
            )}
            {o.confidential && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-white">confidential</span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-700">
            <b>{o.title}</b> · {o.quantity} {o.quantity === 1 ? 'copy' : 'copies'} · {specLabel(o.spec)}
          </p>
          <p className="text-xs text-slate-500">
            {o.source.kind === 'REPORT_CARDS'
              ? `${o.source.issuedCount} issued cards · serials ${o.source.serialFrom} – ${o.source.serialTo}`
              : `${o.source.filename} · ${(o.source.bytes / 1024 / 1024).toFixed(1)} MB`}
            {o.neededBy && <> · school needs it by <b>{pressDateLabel(o.neededBy)}</b></>}
            {' '}· asked {pressDateLabel(o.createdAt)}
          </p>
          {o.orderNote && <p className="mt-1 text-xs italic text-slate-600">&ldquo;{o.orderNote}&rdquo;</p>}
        </div>

        {/* The parcel label — verbatim, ready to copy. */}
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="font-semibold text-slate-800">{o.deliverTo.schoolName}</div>
          <div>{o.deliverTo.address || '— no address on the school profile —'}</div>
          <div>{o.deliverTo.contactName}{o.deliverTo.phone && ` · ${o.deliverTo.phone}`}</div>
        </div>
      </div>

      {o.quote && (
        <p className="mt-2 text-xs text-slate-600">
          Quoted <b>{rupees(o.quote.priceMinor)}</b> · promised by <b>{pressDateLabel(o.quote.promisedBy)}</b>
          {o.quote.note && <> · {o.quote.note}</>}
        </p>
      )}

      {/* ── Actions the transition map allows from here ─────────────────── */}
      <div className="mt-3 flex flex-col gap-2">
        {(o.status === 'REQUESTED' || o.status === 'QUOTED') && (
          <>
            <QuoteForm orderId={o.id}
              initial={o.quote ? { priceMinor: o.quote.priceMinor, promisedBy: o.quote.promisedBy } : null}
              onDone={refresh} />
            {!declining ? (
              <button type="button" onClick={() => setDeclining(true)}
                className="self-start text-xs font-semibold text-rose-600 hover:underline">
                Decline this order…
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <input className="min-w-[240px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  maxLength={300} placeholder="Why? The school reads this on its timeline."
                  value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
                <button type="button" disabled={declineReason.trim().length < 3 || move.isPending}
                  onClick={() => move.mutate({ path: 'decline', body: { reason: declineReason.trim() } })}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
                  Decline
                </button>
                <button type="button" onClick={() => setDeclining(false)}
                  className="text-xs font-semibold text-slate-500">Keep it</button>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {artifactReady && o.kind === 'REPORT_CARDS' && (
            <Link href={`/platform/orders/${o.id}/print`}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
              Open the sheets
            </Link>
          )}
          {artifactReady && o.kind === 'UPLOAD' && (
            <button type="button" onClick={() => openUpload.mutate()} disabled={openUpload.isPending}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">
              {openUpload.isPending ? 'Unlocking…' : 'Open the PDF (15-min link)'}
            </button>
          )}
          {o.status === 'CONFIRMED' && (
            <button type="button" disabled={move.isPending} onClick={() => move.mutate({ path: 'printing' })}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
              Start printing
            </button>
          )}
          {o.status === 'PRINTING' && (
            <>
              <input className="w-36 rounded-md border border-slate-300 px-2 py-1.5 text-sm" maxLength={60}
                placeholder="Courier" value={courier} onChange={(e) => setCourier(e.target.value)} />
              <input className="w-36 rounded-md border border-slate-300 px-2 py-1.5 text-sm" maxLength={60}
                placeholder="Tracking ref (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <button type="button" disabled={courier.trim().length < 2 || move.isPending}
                onClick={() => move.mutate({ path: 'dispatch', body: { courier: courier.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) } })}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
                Dispatched
              </button>
              <button type="button" disabled={move.isPending} onClick={() => move.mutate({ path: 'delivered' })}
                className="rounded-lg border border-emerald-600 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-40">
                Hand-delivered
              </button>
            </>
          )}
          {o.status === 'DISPATCHED' && (
            <button type="button" disabled={move.isPending} onClick={() => move.mutate({ path: 'delivered' })}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
              Delivered
            </button>
          )}
        </div>
      </div>
    </div>
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
  const refresh = () => void qc.invalidateQueries({ queryKey: ['owner-print-orders'] });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Print orders</h1>
        <p className="text-sm text-slate-500">
          Schools&rsquo; printing, fulfilled by us. Quote it, keep the promise, ship it — every move lands on the
          school&rsquo;s own timeline.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              filter === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {orders.isLoading && <p className="text-sm text-slate-500">Loading the queue…</p>}
      {orders.isError && <p className="text-sm text-rose-600">The queue could not load — refresh to try again.</p>}
      {orders.data?.length === 0 && (
        <p className="text-sm text-slate-500">
          Nothing here. New requests land under <b>Needs quote</b> the moment a school sends one.
        </p>
      )}

      <div className="space-y-3">
        {(orders.data ?? []).map((o) => <OrderCard key={o.id} o={o} refresh={refresh} />)}
      </div>
    </div>
  );
}
