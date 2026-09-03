'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Ban, Printer, Search } from 'lucide-react';
import type { PressDocType, PressIssueRow, PressRegisterPage, PressSnapshot } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { PRESS_TYPE_LABEL, pressDateLabel, printPressSheets, getPressTemplate } from '@/lib/press';
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

type OneIssue = { id: string; type: string; serial: string; issuedAt: string; voidedAt: string | null; voidNote: string | null; snapshot: PressSnapshot };

export default function PressRegisterPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const qc = useQueryClient();
  const [filter, setFilter] = useState<PressDocType | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [reprint, setReprint] = useState<OneIssue | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  /** The entry whose void-note row is open, and the note being typed. */
  const [voiding, setVoiding] = useState<{ id: string; note: string } | null>(null);
  const printedIdRef = useRef<string | null>(null);

  // The command bar and the Press counter link here as /register?q=SERIAL —
  // seed the filter from the URL once, after mount (no Suspense dance).
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('q');
    if (fromUrl) setQ(fromUrl);
  }, []);

  // Print AFTER the reprint content committed — a timer raced React and could
  // open the dialog on an empty portal (blank pages).
  useEffect(() => {
    if (!reprint || printedIdRef.current === reprint.id) return;
    printedIdRef.current = reprint.id;
    printPressSheets();
  }, [reprint]);

  /** Older pages, appended below the live first page. A register is a book —
   *  every entry stays reachable, not just the newest 50. */
  const [older, setOlder] = useState<PressIssueRow[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

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
      printedIdRef.current = null; // re-opening the same entry prints again
      setReprint(row);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not open that entry.');
    } finally {
      setFetching(null);
    }
  }

  const voidIssue = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post<{ voided: true }>(`/manage/press/register/${id}/void`, { note }),
    onSuccess: () => {
      setVoiding(null);
      qc.invalidateQueries({ queryKey: ['press-register', host] });
      toast.success('Entry voided — struck through, never erased. Issue afresh from the batch or the desk.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Voiding failed — nothing changed.'),
  });

  // A fresh first page (filter change, void refetch) restarts the walk.
  useEffect(() => { setOlder([]); setOlderCursor(null); }, [page.data]);

  const items: PressIssueRow[] = [...(page.data?.items ?? []), ...older];
  const nextCursor = olderCursor ?? page.data?.nextCursor ?? null;

  async function loadOlder() {
    if (!nextCursor) return;
    setLoadingOlder(true);
    try {
      const res = await api.get<PressRegisterPage>(
        `/manage/press/register?${new URLSearchParams({
          ...(filter !== 'ALL' ? { type: filter } : {}),
          ...(q.trim() ? { q: q.trim() } : {}),
          cursor: nextCursor,
        })}`,
      );
      setOlder((prev) => [...prev, ...res.items]);
      setOlderCursor(res.nextCursor);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not load older entries.');
    } finally {
      setLoadingOlder(false);
    }
  }

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
                  <React.Fragment key={r.id}>
                    <tr style={{ borderTop: '1px solid var(--sk-line)', opacity: r.voidedAt ? 0.65 : 1 }}>
                      <td style={{ padding: '8px 8px 8px 16px', fontWeight: 650, whiteSpace: 'nowrap', textDecoration: r.voidedAt ? 'line-through' : undefined }}>{r.serial}</td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        <span className="sk-pill" data-tone={r.type === 'REPORT_CARD' ? 'info' : 'neutral'}>
                          {PRESS_TYPE_LABEL[r.type]}
                        </span>
                        {r.voidedAt && <span className="sk-pill" data-tone="bad" style={{ marginLeft: 6 }}>VOID</span>}
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{r.studentName}</td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap', color: 'var(--sk-ink-3)' }}>{pressDateLabel(r.issuedAt)}</td>
                      <td style={{ padding: '8px 16px 8px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          className="sk-btn" data-icon aria-label={`Reprint ${r.serial}`}
                          disabled={fetching === r.id}
                          onClick={() => openReprint(r.id)}
                        >
                          <Printer size={15} aria-hidden="true" />
                        </button>
                        {!r.voidedAt && (
                          <button
                            className="sk-btn" data-icon data-tone="bad" aria-label={`Void ${r.serial}`}
                            style={{ marginLeft: 6 }}
                            onClick={() => setVoiding(voiding?.id === r.id ? null : { id: r.id, note: '' })}
                          >
                            <Ban size={15} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {voiding?.id === r.id && (
                      <tr>
                        <td colSpan={5} style={{ padding: '4px 16px 12px' }}>
                          <form
                            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                            onSubmit={(e) => { e.preventDefault(); if (voiding) voidIssue.mutate(voiding); }}
                          >
                            <input
                              className="sk-input" style={{ flex: 1 }} autoFocus
                              minLength={3} maxLength={300} required
                              placeholder={`Why is ${r.serial} being struck through? e.g. "wrong marks — reissued after correction"`}
                              value={voiding?.note ?? ''}
                              onChange={(e) => setVoiding({ id: r.id, note: e.target.value })}
                            />
                            <button type="submit" className="sk-btn" data-variant="primary" disabled={voidIssue.isPending}>
                              {voidIssue.isPending ? 'Voiding…' : 'Void entry'}
                            </button>
                            <button type="button" className="sk-btn" onClick={() => setVoiding(null)}>Cancel</button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nextCursor && (
        <button className="sk-btn" style={{ alignSelf: 'center' }} disabled={loadingOlder} onClick={loadOlder}>
          {loadingOlder ? 'Turning the page…' : 'Show older entries'}
        </button>
      )}

      {reprint && (
        <PressPrintPortal>
          {reprint.snapshot.kind === 'REPORT_CARD' ? (
            <ReportCardSheet
              snapshot={reprint.snapshot}
              serial={reprint.serial}
              stamp={reprint.voidedAt ? 'CANCELLED' : 'DUPLICATE'}
              template={getPressTemplate()}
            />
          ) : (
            <CertificateSheet
              snapshot={reprint.snapshot}
              serial={reprint.serial}
              issuedAt={reprint.issuedAt}
              stamp={reprint.voidedAt ? 'CANCELLED' : 'DUPLICATE'}
            />
          )}
        </PressPrintPortal>
      )}
    </div>
  );
}
