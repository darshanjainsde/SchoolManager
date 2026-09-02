'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { type FeeReceiptDocument } from '@/lib/fees';
import { BackToFees } from '@/components/fees/back-to-fees';
import { FeeReceiptSheet } from '@/components/fees/fee-receipt-sheet';
import { BodyPrintPortal } from '@/components/press/press-print-portal';
import '@/components/fees/receipt-print.css';

/**
 * The counter's copy of a receipt.
 *
 * Same document the family sees, from the same endpoint family — a parent who
 * lost their copy asks at the office, and a clerk should be able to reprint it
 * without signing in as them. Reads `/manage/fees/receipts/:id`, which is
 * school-scoped rather than student-scoped; the parent route is the one that
 * pins the student.
 */
export default function OfficeReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const receipt = useQuery({
    queryKey: ['fee-receipt', host, id],
    enabled: !!host,
    retry: false,
    queryFn: () => api.get<FeeReceiptDocument>(`/manage/fees/receipts/${id}`),
  });

  function print() {
    document.body.classList.add('fee-receipt-printing');
    const done = () => {
      document.body.classList.remove('fee-receipt-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    window.setTimeout(done, 60_000);
  }

  if (receipt.error instanceof ApiError) {
    return (
      <div className="flex flex-col gap-3">
        <BackToFees />
        <p className="sk-state">
          {receipt.error.status === 404
            ? 'No receipt has been issued for this payment. A receipt exists only once the payment has been accepted.'
            : receipt.error.message}
        </p>
      </div>
    );
  }

  if (receipt.isLoading || !receipt.data) {
    return (
      <div className="flex flex-col gap-3">
        <BackToFees />
        <p className="sk-state">Loading the receipt…</p>
      </div>
    );
  }

  const r = receipt.data;

  return (
    <div className="flex flex-col gap-3">
      <BackToFees />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-[17px] font-bold" style={{ color: 'var(--sk-ink)' }}>
            Receipt {r.receiptNumber}
          </h2>
          <p className="text-[12.5px]" style={{ color: 'var(--sk-ink-3)' }}>
            {r.student.name} · admission no. {r.student.admissionNo}
          </p>
        </div>
        <button type="button" className="sk-btn" data-variant="primary" onClick={print}>
          <Printer size={14} aria-hidden="true" />
          Print
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
