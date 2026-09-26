'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileText, FileUp, GraduationCap, Package } from 'lucide-react';
import type { PrintOrderRow, PrintOrderStatus } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { rupees } from '@/lib/fees';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, pressDateLabel, specLabel } from '@/lib/press';
import { OrderDrawer } from '@/components/press/order-drawer';
import { HubDoor, HubDoors, HubKpi, HubKpis, HubPage } from '@/components/ui/hub';
import { Cell, Row, RowList, RowTitle } from '@/components/ui/kit';

/**
 * Print Store — everything the school has sent to Sckools to print, as a hub.
 *
 * Numbers: what is printing, what is waiting on the school's own yes, when
 * the next box arrives, what has been delivered. Then the order book as ROWS
 * (status and money line up down the list), then three doors that say what
 * the store is for — a new school landed on one lonely card in a void and
 * could not tell.
 *
 * No prices on the doors: every job is quoted first, and a guide price that
 * the quote then differs from is a broken promise.
 */

/** Statuses in the school's hands or in Sckools' — not finished either way. */
const OPEN: PrintOrderStatus[] = ['REQUESTED', 'QUOTED', 'CONFIRMED', 'PRINTING', 'DISPATCHED'];
/** Confirmed and moving: the school has said yes and the job is somewhere between the press and the door. */
const MOVING: PrintOrderStatus[] = ['CONFIRMED', 'PRINTING', 'DISPATCHED'];
type Filter = 'open' | 'done' | 'all';

export default function PressOrdersPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const hydrated = useHydrated();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const orders = useQuery({
    queryKey: ['press-orders', host], enabled: !!host,
    queryFn: () => api.get<PrintOrderRow[]>('/manage/press/orders'),
  });

  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const open = all.filter((o) => OPEN.includes(o.status));
  const shown = filter === 'all' ? all : filter === 'open' ? open : all.filter((o) => !OPEN.includes(o.status));
  const quoted = all.filter((o) => o.status === 'QUOTED');
  const moving = all.filter((o) => MOVING.includes(o.status));
  const delivered = all.filter((o) => o.status === 'DELIVERED');
  const nextDelivery = moving
    .map((o) => o.quote?.promisedBy)
    .filter((d): d is string => !!d)
    .sort()[0];
  const deliveredMinor = delivered.reduce((n, o) => n + (o.quote?.priceMinor ?? 0), 0);

  return (
    <HubPage
      title="Print Store"
      subtitle="Sckools prints and delivers — bulk report cards, exam papers, anything on paper. You confirm the price first."
      action={
        <button className="sk-btn sk-press" data-variant="primary" onClick={() => setUploadOpen(true)}>
          <FileUp size={15} aria-hidden="true" /> Send a PDF to print
        </button>
      }
    >
      {orders.isError && <p className="sk-state err">The orders could not load. Refresh to try again.</p>}

      {orders.data && (
        <HubKpis>
          <HubKpi label="Printing now" value={moving.length} hint={moving[0] ? moving[0].title : 'nothing on the press'} />
          <HubKpi
            label="Waiting for your OK" value={quoted.length} tone={quoted.length ? 'warn' : undefined}
            hint={quoted.length ? `${rupees(quoted.reduce((n, o) => n + (o.quote?.priceMinor ?? 0), 0))} quoted` : 'no quote to confirm'}
          />
          <HubKpi label="Next delivery" value={nextDelivery ? pressDateLabel(nextDelivery) : '—'} hint={nextDelivery ? 'promised by Sckools' : 'nothing on its way'} />
          <HubKpi label="Delivered" value={delivered.length} hint={delivered.length ? `${rupees(deliveredMinor)} in all` : 'no order delivered yet'} tone={delivered.length ? 'good' : undefined} />
        </HubKpis>
      )}

      <section className="sk-card sk-hublist" aria-label="Orders">
        <div className="sk-card-h sk-hublist-h">
          <h3>Orders</h3>
          <div className="sk-hubchips" role="group" aria-label="Show">
            {(['open', 'done', 'all'] as Filter[]).map((f) => (
              <button key={f} type="button" className="sk-hubchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'open' ? `Open · ${open.length}` : f === 'done' ? 'Done' : 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="sk-card-b">
          {orders.isLoading && <p className="sk-state" style={{ margin: 0 }}>Opening the order book…</p>}
          {orders.data && shown.length === 0 && (
            <p className="sk-state" style={{ margin: 0 }}>
              {all.length === 0
                ? <>Nothing ordered yet. Send any PDF from here — exam papers, circulars, admission forms — or open an issued batch in the Result Room and choose <b>Print via Sckools</b>. We quote a price and a delivery date; printing starts when you confirm.</>
                : filter === 'open' ? 'Nothing open — every order has been delivered or closed.' : 'Nothing finished yet.'}
            </p>
          )}
          {shown.length > 0 && (
            <HubOrderRows rows={shown} />
          )}
        </div>
      </section>

      <HubDoors>
        <HubDoor href="/app/press/results" icon={GraduationCap} tint="var(--sk-brand)" title="Report cards" meta="Print an issued batch from the Result Room · quote first" />
        <HubDoor onClick={() => setUploadOpen(true)} icon={FileText} tint="var(--sk-amber)" title="Exam papers & circulars" meta="Send the PDF, say how many · quote first" />
        <HubDoor onClick={() => setUploadOpen(true)} icon={Package} tint="var(--sk-good)" title="Anything on paper" meta="Forms, ID cards, banners · quote first" />
      </HubDoors>

      {hydrated && uploadOpen && <OrderDrawer target={{ kind: 'UPLOAD' }} onClose={() => setUploadOpen(false)} />}
    </HubPage>
  );
}

/** The order book as rows whose columns line up: what · spec · where it stands · money and date. */
function HubOrderRows({ rows }: { rows: PrintOrderRow[] }) {
  return (
    <RowList columns="minmax(0, 1.5fr) minmax(0, 1.2fr) auto auto" label="Orders">
      {rows.map((o) => (
        <Row key={o.id}>
          <Cell>
            <Link href={`/app/press/orders/${o.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="av" style={{ width: 34, height: 34, borderRadius: 10, flex: 'none', display: 'grid', placeItems: 'center', color: '#fff', background: o.kind === 'UPLOAD' ? 'var(--sk-amber)' : 'var(--sk-brand)' }}>
                {o.kind === 'UPLOAD' ? <FileUp size={16} aria-hidden="true" /> : <Package size={16} aria-hidden="true" />}
              </span>
              <span style={{ minWidth: 0 }}>
                <RowTitle title={o.title} sub={`${o.quantity} ${o.quantity === 1 ? 'copy' : 'copies'}`} />
              </span>
            </Link>
          </Cell>
          <Cell><span style={{ fontSize: 12.5, color: 'var(--sk-ink-2)' }}>{specLabel(o.spec)}</span></Cell>
          <Cell align="end"><span className="sk-pill" data-tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</span></Cell>
          <Cell align="end">
            <span style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
              {o.quote ? <><b className="sk-num">{rupees(o.quote.priceMinor)}</b> · by {pressDateLabel(o.quote.promisedBy)}</> : <span className="sk-muted">asked {pressDateLabel(o.createdAt)}</span>}
            </span>
          </Cell>
        </Row>
      ))}
    </RowList>
  );
}
