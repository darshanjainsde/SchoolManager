'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Printer, Search } from 'lucide-react';
import type { PressDocType, PressRegisterPage, PressSnapshot } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { PRESS_TYPE_LABEL, pressDateLabel, printPressSheets } from '@/lib/press';
import { CertificateSheet, ReportCardSheet } from '@/components/press/press-sheets';
import { PressPrintPortal } from '@/components/press/press-print-portal';
import '@/components/press/press-print.css';

/**
 * The register — the drawer of everything ever issued.
 *
 * A reprint renders the STORED snapshot, never a fresh compile: a card
 * reprinted in March says what it said in September, whatever the marks table
 * says now. Certificate reprints are DUPLICATE-stamped — the original went out
 * once, and every later copy says what it is, the way a paper TC book's office
 * copy would.
 */

const FILTERS: (PressDocType | 'ALL')[] = ['ALL', 'REPORT_CARD', 'TC', 'BONAFIDE', 'CHARACTER'];

type OneIssue = { id: string; type: string; serial: string; issuedAt: string; snapshot: PressSnapshot };

export default function PressRegisterPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const [filter, setFilter] = useState<PressDocType | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [reprint, setReprint] = useState<OneIssue | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);

  const page = useQuery({
    queryKey: ['press-register', host, filter, q], enabled: !!host,
    queryFn: () =>
      api.get<PressRegisterPage>(
        `/manage/press/register?${new URLSearchParams({
          ...(filter !== 'ALL' ? { type: filter } : {}),
          ...(q.trim() ? { q: q.trim() } : {}),
        })}`,
      ),
  });

  async function openReprint(id: string) {
    setFetching(id);
    try {
      const row = await api.get<OneIssue>(`/manage/press/register/${id}`);
      setReprint(row);
      setTimeout(printPressSheets, 60);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not open that entry.');
    } finally {
      setFetching(null);
    }
  }

  const items = page.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="sk-pagehead">
        <Link href="/app/press" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <ArrowLeft size={13} aria-hidden="true" /> The Press
        </Link>
        <h1>The register</h1>
        <p>Every document issued, in serial order. Reprints come from here — stamped, so an original stays an original.</p>
      </header>

      <div className="sk-card">
        <div className="sk-card-b">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {FILTERS.map((f) => (
              <button key={f} className="sk-btn" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'ALL' ? 'Everything' : PRESS_TYPE_LABEL[f]}
              </button>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 200 }}>
              <Search size={14} style={{ color: 'var(--sk-ink-3)', flex: 'none' }} aria-hidden="true" />
              <input
                className="sk-input" style={{ flex: 1 }}
                placeholder="Serial, name or admission number…"
                value={q} onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
        </div>

        {page.isLoading && <p className="sk-state" style={{ padding: '0 16px 16px' }}>Opening the drawer…</p>}
        {page.isError && <p className="sk-state err" style={{ padding: '0 16px 16px' }}>The register could not load. Refresh to try again.</p>}

        {page.data && items.length === 0 && (
          <p className="sk-state" style={{ padding: '0 16px 16px' }}>
            {q.trim() || filter !== 'ALL'
              ? 'Nothing matches this filter.'
              : 'Nothing issued yet. The first report card batch or certificate lands here with its serial.'}
          </p>
        )}

        {items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--sk-ink-3)', fontSize: 11.5 }}>
                  <th style={{ padding: '4px 8px 8px 16px' }}>Serial</th>
                  <th style={{ padding: '4px 8px 8px' }}>Document</th>
                  <th style={{ padding: '4px 8px 8px' }}>Student</th>
                  <th style={{ padding: '4px 8px 8px' }}>Issued</th>
                  <th style={{ padding: '4px 16px 8px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--sk-line)' }}>
                    <td style={{ padding: '8px 8px 8px 16px', fontWeight: 650, whiteSpace: 'nowrap' }}>{r.serial}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                      <span className="sk-pill" data-tone={r.type === 'REPORT_CARD' ? 'info' : 'neutral'}>
                        {PRESS_TYPE_LABEL[r.type]}
                      </span>
                    </td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{r.studentName}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap', color: 'var(--sk-ink-3)' }}>{pressDateLabel(r.issuedAt)}</td>
                    <td style={{ padding: '8px 16px 8px 8px', textAlign: 'right' }}>
                      <button
                        className="sk-btn" data-icon aria-label={`Reprint ${r.serial}`}
                        disabled={fetching === r.id}
                        onClick={() => openReprint(r.id)}
                      >
                        <Printer size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {page.data?.nextCursor && (
        <p className="sk-state">Showing the latest 50. Search narrows further back.</p>
      )}

      {reprint && (
        <PressPrintPortal>
          {reprint.snapshot.kind === 'REPORT_CARD' ? (
            <ReportCardSheet snapshot={reprint.snapshot} duplicate={false} />
          ) : (
            <CertificateSheet
              snapshot={reprint.snapshot}
              serial={reprint.serial}
              issuedAt={reprint.issuedAt}
              duplicate
            />
          )}
        </PressPrintPortal>
      )}
    </div>
  );
}
