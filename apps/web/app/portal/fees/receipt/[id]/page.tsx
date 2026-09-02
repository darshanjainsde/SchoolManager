'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Printer } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { type FeeReceiptDocument } from '@/lib/fees';
import { FeeReceiptSheet } from '@/components/fees/fee-receipt-sheet';
import { BodyPrintPortal } from '@/components/press/press-print-portal';
import '@/components/fees/receipt-print.css';

/**
 * A family's receipt, as a document they can open, print or save.
 *
 * Before this, a verified payment surfaced as a receipt NUMBER inside a line
 * of text on the fees page — nothing a parent could produce when a scholarship
 * form, a landlord or the next school asked for proof of payment. The number
 * was real; there was simply no paper behind it.
 *
 * The sheet is rendered TWICE from one component: on screen inside
 * `.rc-preview`, and again into a body-level print portal. The portal is not
 * optional — both print stylesheets in this codebase hide every direct child
 * of `<body>` during a print, so a container nested in the app tree prints
 * blank pages. The Press measured that; this reuses its portal rather than
 * rediscovering it.
 */
export default function PortalReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const receipt = useQuery({
    queryKey: ['me-fee-receipt', host, id],
    enabled: !!host,
    retry: false,
    queryFn: () => api.get<FeeReceiptDocument>(`/me/fees/receipts/${id}`),
  });

  function print() {
    document.body.classList.add('fee-receipt-printing');
    const done = () => {
      document.body.classList.remove('fee-receipt-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    // Safari never fires afterprint from a cancelled dialog.
    window.setTimeout(done, 60_000);
  }

  const back = (
    <Link
      href="/portal/fees"
      className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold"
      style={{ color: 'var(--sk-ink-3)' }}
    >
      <ChevronLeft size={14} aria-hidden="true" />
      Fees
    </Link>
  );

  // 404 covers three real cases and must not read like a crash: no receipt has
  // been issued yet (the payment is still being checked, or was refused), and
  // a receipt id that belongs to another family.
  if (receipt.error instanceof ApiError) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <div className="sk-card">
          <div className="sk-card-b">
            <p className="text-[13px]" style={{ color: 'var(--sk-ink-2)' }}>
              {receipt.error.status === 404
                ? 'No receipt has been issued for this payment yet. A receipt appears here once the school has confirmed the money — until then the payment shows as “Being checked” on your fees page.'
                : receipt.error.message}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (receipt.isLoading || !receipt.data) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="py-10 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>
          Loading your receipt…
        </p>
      </div>
    );
  }

  const r = receipt.data;

  return (
    <div className="flex flex-col gap-3">
      {back}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-[17px] font-bold" style={{ color: 'var(--sk-ink)' }}>
            Receipt {r.receiptNumber}
          </h2>
          <p className="text-[12.5px]" style={{ color: 'var(--sk-ink-3)' }}>
            Keep this for your records. It is valid without a signature.
          </p>
        </div>
        <button type="button" className="sk-btn" onClick={print}>
          <Printer size={14} aria-hidden="true" />
          Print or save as PDF
        </button>
      </div>

      <div className="rc-preview">
        <div className="rc-zoom">
          <FeeReceiptSheet r={r} />
        </div>
      </div>

      <BodyPrintPortal id="fee-receipt-print">
        <FeeReceiptSheet r={r} />
      </BodyPrintPortal>
    </div>
  );
}
