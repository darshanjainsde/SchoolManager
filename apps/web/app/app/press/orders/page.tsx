'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileUp, Package } from 'lucide-react';
import type { PrintOrderRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { rupees } from '@/lib/fees';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, pressDateLabel, specLabel } from '@/lib/press';
import { OrderDrawer } from '@/components/press/order-drawer';

/**
 * Print orders — everything the school has sent to Sckools to print.
 *
 * The list is the school's side of the ledger: what was asked, what was
 * quoted, where it stands. A QUOTED row glows — that is the one waiting on
 * the school's own yes.
 */
export default function PressOrdersPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const hydrated = useHydrated();
  const [uploadOpen, setUploadOpen] = useState(false);

  const orders = useQuery({
    queryKey: ['press-orders', host], enabled: !!host,
    queryFn: () => api.get<PrintOrderRow[]>('/manage/press/orders'),
  });

  const rows = orders.data ?? [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead sk-wrap-sm" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Print Store</h1>
          <p>Sckools prints and delivers — bulk report cards, exam papers, anything on paper. You confirm the price first.</p>
        </div>
        <button className="sk-btn" data-variant="primary" onClick={() => setUploadOpen(true)}>
          <FileUp size={15} aria-hidden="true" /> Send a PDF to print
        </button>
      </header>

      {orders.isLoading && <p className="sk-state">Opening the order book…</p>}
      {orders.isError && <p className="sk-state err">The orders could not load. Refresh to try again.</p>}

      {orders.data && rows.length === 0 && (
        <div className="sk-card"><div className="sk-card-b">
          <p className="sk-state">
            Nothing ordered yet. Send any PDF from here — exam papers, circulars, admission forms — or open an issued
            batch in the Result Room and choose <b>Print via Sckools</b>. We quote a price and a delivery date;
            printing starts when you confirm.
          </p>
        </div></div>
      )}

      {rows.length > 0 && (
        <div className="sk-cardgrid" style={{ gridTemplateColumns: '1fr' }}>
          {rows.map((o) => (
            <Link key={o.id} href={`/app/press/orders/${o.id}`} className="sk-entity sk-press">
              <span className="av" style={{ background: o.kind === 'UPLOAD' ? 'var(--sk-amber)' : 'var(--sk-brand)' }}>
                {o.kind === 'UPLOAD' ? <FileUp size={18} aria-hidden="true" /> : <Package size={18} aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="nm">
                  {o.title}
                  <span className="sk-pill" data-tone={ORDER_STATUS_TONE[o.status]} style={{ marginLeft: 8 }}>
                    {ORDER_STATUS_LABEL[o.status]}
                  </span>
                </div>
                <div className="meta">
                  {o.quantity} {o.quantity === 1 ? 'copy' : 'copies'} · {specLabel(o.spec)}
                  {o.quote && <> · {rupees(o.quote.priceMinor)} · by {pressDateLabel(o.quote.promisedBy)}</>}
                  {!o.quote && <> · asked {pressDateLabel(o.createdAt)}</>}
                </div>
              </div>
              <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}

      {hydrated && uploadOpen && <OrderDrawer target={{ kind: 'UPLOAD' }} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
