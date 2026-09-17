'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RECEIPT_CSS, receiptBody, type FeeReceiptDoc } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { BodyPrintPortal } from '@/components/press/press-print-portal';
import '../receipt-print.css';

/** Print only the receipt: flag the body, wait for the portal, print, unflag. */
function printReceipt(): void {
  const fire = (attempt: number) => {
    if (!document.getElementById('receipt-print')) {
      if (attempt < 20) requestAnimationFrame(() => fire(attempt + 1));
      return;
    }
    document.body.classList.add('receipt-printing');
    const done = () => document.body.classList.remove('receipt-printing');
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    setTimeout(done, 1500);
  };
  fire(0);
}

/**
 * One confirmed payment as a document — the same `receiptBody` the phone
 * prints to a PDF, so what a family keeps is identical on both.
 */
export default function ReceiptPage() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({
    queryKey: ['me-receipt', host, paymentId], enabled: !!host && !!paymentId, retry: false,
    queryFn: () => api.get<FeeReceiptDoc>(`/me/fees/receipts/${paymentId}`),
  });

  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-10" />;
  if (q.isLoading || !q.data) return <p className="py-10 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>Opening the receipt…</p>;

  const html = receiptBody(q.data);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/portal/fees" className="sk-btn">← Fees</Link>
        <button className="sk-btn" data-variant="primary" onClick={printReceipt} data-testid="receipt-print">Print or save as PDF</button>
      </div>
      <style>{RECEIPT_CSS}</style>
      <div className="sk-card" style={{ padding: 16 }} data-testid="receipt-preview" dangerouslySetInnerHTML={{ __html: html }} />
      <BodyPrintPortal id="receipt-print">
        <style>{RECEIPT_CSS}</style>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </BodyPrintPortal>
    </div>
  );
}
