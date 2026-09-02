'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import type { PressSnapshot } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { pressDateLabel, printPressSheets } from '@/lib/press';
import { ReportCardSheet } from '@/components/press/press-sheets';
import { PressPrintPortal } from '@/components/press/press-print-portal';
import '@/components/press/press-print.css';

/**
 * One issued report card, exactly as the office printed it.
 *
 * This renders the register SNAPSHOT — not a live compile — so the family's
 * copy and the paper copy in the drawer are the same document, forever. If
 * marks are later corrected, the office issues afresh and a new card appears
 * here; this one does not quietly change under the family.
 */
export default function MyReportCardPage() {
  const { id } = useParams<{ id: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const card = useQuery({
    queryKey: ['my-report-card', host, id], enabled: !!host,
    queryFn: () => api.get<{ id: string; serial: string; issuedAt: string; snapshot: PressSnapshot }>(`/me/report-cards/${id}`),
    retry: false,
  });

  const snap = card.data?.snapshot;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <Link href="/portal/results" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <ArrowLeft size={13} aria-hidden="true" /> Results
          </Link>
          <h1>Report card</h1>
          {card.data && (
            <p>
              {snap?.kind === 'REPORT_CARD' ? `${snap.windowName} · ${snap.academicYearName} · ` : ''}
              issued {pressDateLabel(card.data.issuedAt)} · serial {card.data.serial}
            </p>
          )}
        </div>
        {snap?.kind === 'REPORT_CARD' && (
          <button className="sk-btn" onClick={printPressSheets}>
            <Printer size={15} aria-hidden="true" /> Print
          </button>
        )}
      </header>

      {card.isLoading && <p className="sk-state">Opening the card…</p>}
      {card.isError && (
        <p className="sk-state err">
          {card.error instanceof ApiError && card.error.status === 404
            ? 'This report card was not found.'
            : 'The card could not load. Refresh to try again.'}
        </p>
      )}

      {snap?.kind === 'REPORT_CARD' && (
        <>
          <div className="pr-preview">
            <div className="pr-zoom">
              <ReportCardSheet snapshot={snap} serial={card.data!.serial} />
            </div>
          </div>
          <PressPrintPortal>
            <ReportCardSheet snapshot={snap} serial={card.data!.serial} />
          </PressPrintPortal>
        </>
      )}
    </div>
  );
}
