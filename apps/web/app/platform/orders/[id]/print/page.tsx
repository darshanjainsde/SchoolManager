'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { OperatorOrderArtifact, OperatorOrderRow, PrintOrderDetail } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { printPressSheets, specLabel } from '@/lib/press';
import { ReportCardSheet } from '@/components/press/press-sheets';
import { PressPrintPortal } from '@/components/press/press-print-portal';
import '@/components/press/press-print.css';

/**
 * The press-side print run for one report-card order.
 *
 * The sheets are the register's FROZEN snapshots, fetched verbatim — this
 * page recompiles nothing and could not: what comes out of the printer here
 * is byte-identical to what the school issued. Official first prints: serial
 * on every card, no stamp.
 */
export default function OperatorPrintRunPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });

  const order = useQuery({
    queryKey: ['owner-print-order', id],
    queryFn: () => api.get<PrintOrderDetail & { schoolName: string }>(`/owner/print-orders/${id}`),
  });
  const artifact = useQuery({
    queryKey: ['owner-print-artifact', id],
    queryFn: () => api.get<OperatorOrderArtifact>(`/owner/print-orders/${id}/artifact`),
  });

  const o = order.data;
  const sheets = artifact.data?.kind === 'REPORT_CARDS' ? artifact.data.sheets : [];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/platform/orders" className="text-xs font-semibold text-slate-500 hover:underline">
          ← Print orders
        </Link>
        <h1 className="sk-own-h1">{o ? o.title : 'Print run'}</h1>
        {o && (
          <p className="sk-muted">
            {o.schoolName} · {specLabel(o.spec)} · print <b className="text-slate-800">{o.quantity}</b>{' '}
            {o.quantity === 1 ? 'copy' : 'copies'} of the set
          </p>
        )}
      </div>

      {(order.isLoading || artifact.isLoading) && <p className="sk-muted">Unfreezing the register…</p>}
      {artifact.isError && (
        <p className="text-sm text-rose-600">
          The sheets are locked until the school confirms the order — check its status on the desk.
        </p>
      )}

      {sheets.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <button type="button" onClick={printPressSheets}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Print {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}
            </button>
            <span className="sk-muted">
              Frozen register snapshots — exactly what the school issued, serials included.
            </span>
          </div>

          {/* On-screen check of the first card, so nobody runs a batch blind. */}
          <div className="pr-preview">
            <div className="pr-zoom">
              <ReportCardSheet snapshot={sheets[0]!.snapshot} serial={sheets[0]!.serial} />
            </div>
          </div>

          <PressPrintPortal>
            {sheets.map((s) => (
              <ReportCardSheet key={s.serial} snapshot={s.snapshot} serial={s.serial} />
            ))}
          </PressPrintPortal>
        </>
      )}
    </div>
  );
}
