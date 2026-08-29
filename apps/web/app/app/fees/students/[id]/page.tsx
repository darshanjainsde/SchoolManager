'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { METHOD_LABEL, fmtDate, rupees, type StudentFees } from '@/lib/fees';

type Tab = 'bills' | 'payments' | 'ledger';

/**
 * One child's whole fee position — the screen the office opens when a parent
 * rings to argue, and where every fee list ends.
 *
 * Three tabs on one record rather than three pages, because the API returns
 * bills, payments and the ledger in a single call and they are three views of
 * the same argument: what was charged, what came in, and the append-only truth
 * that reconciles them.
 */
export default function StudentFeeDetailPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [tab, setTab] = useState<Tab>('bills');

  const q = useQuery({
    queryKey: ['fee-student', host, id], enabled: !!host && !!id, retry: false,
    queryFn: () => api.get<StudentFees>(`/manage/fees/students/${id}`),
  });

  if (q.isLoading) return <p className="sk-state">Loading this student’s fees…</p>;
  if (q.error) return <p className="sk-state err">{(q.error as Error).message}</p>;
  if (!q.data) return null;
  const d = q.data;

  const unpaid = d.invoices.filter((i) => !i.isPaid);
  const owes = d.balanceMinor > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Link href="/app/fees/students"
            className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold"
            style={{ color: 'var(--sk-ink-3)' }}>
        <ChevronLeft size={14} aria-hidden="true" /> Fees by student
      </Link>

      <header className="sk-card">
        <div className="sk-card-b" style={{ flexDirection: 'row', alignItems: 'center', gap: 13, flexWrap: 'wrap' }}>
          <div className="grid h-11 w-11 flex-none place-items-center rounded-[13px] text-[13px] font-bold"
               style={{ background: 'var(--sk-brand)', color: '#fff' }} aria-hidden="true">
            {initials(d.student.name)}
          </div>
          <div className="min-w-0">
            <div className="text-[16px] font-bold" style={{ letterSpacing: '-0.01em' }}>{d.student.name}</div>
            <div className="text-[11.5px]" style={{ color: 'var(--sk-ink-3)', fontFamily: 'var(--sk-mono)' }}>
              {d.student.className ?? '—'} · {d.student.admissionNo}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="sk-lab">{owes ? 'Owes' : d.balanceMinor < 0 ? 'In credit' : 'Balance'}</div>
            <div className="text-[22px] font-bold tabular-nums"
                 style={{ color: owes ? 'var(--sk-bad)' : d.balanceMinor < 0 ? 'var(--sk-good)' : 'var(--sk-ink)' }}>
              {rupees(Math.abs(d.balanceMinor))}
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {([['bills', `Bills · ${d.invoices.length}`], ['payments', `Payments · ${d.payments.length}`], ['ledger', 'Ledger']] as [Tab, string][])
          .map(([id_, label]) => (
            <button key={id_} onClick={() => setTab(id_)} aria-pressed={tab === id_}
                    className="rounded-full border px-3 py-1.5 text-[12.5px] font-semibold"
                    style={{
                      borderColor: tab === id_ ? 'var(--sk-brand)' : 'var(--sk-line-2)',
                      background: tab === id_ ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
                      color: tab === id_ ? 'var(--sk-brand-2)' : 'var(--sk-ink-2)',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}>
              {label}
            </button>
          ))}
      </div>

      {tab === 'bills' && (
        d.invoices.length === 0
          ? <p className="sk-state">No bills have been issued to this student yet.</p>
          : <div className="flex flex-col gap-3">
              {d.invoices.map((inv) => (
                <div key={inv.id} className="sk-card"
                     style={{ borderColor: inv.isOverdue ? 'var(--sk-bad)' : undefined }}>
                  <div className="sk-card-h">
                    <h3>{inv.termName}</h3>
                    <span className="sk-pill" data-tone={inv.isPaid ? 'good' : inv.isOverdue ? 'bad' : 'warn'}
                          style={{ marginLeft: 'auto' }}>
                      {inv.isPaid ? 'Paid' : inv.isOverdue ? `Overdue · due ${fmtDate(inv.dueDate)}` : `Due ${fmtDate(inv.dueDate)}`}
                    </span>
                    <p style={{ fontFamily: 'var(--sk-mono)', fontSize: 11 }}>{inv.number}</p>
                  </div>
                  <div className="sk-card-b">
                    {inv.lines.map((l, i) => (
                      <div key={i} className="flex items-start justify-between gap-3"
                           style={{ borderTop: i ? '1px solid var(--sk-line)' : undefined, paddingTop: i ? 8 : 0 }}>
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold">
                            {l.categoryName}
                            {!l.isCollectible && <span className="sk-pill ml-2" data-tone="info">reimbursed</span>}
                          </div>
                          <div className="text-[11px] leading-snug" style={{ color: 'var(--sk-ink-3)' }}>
                            {l.categoryDescription}
                          </div>
                          {l.concessionReason && (
                            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--sk-good)' }}>
                              −{rupees(l.concessionMinor)} · {l.concessionReason}
                            </div>
                          )}
                        </div>
                        <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums">{rupees(l.netMinor)}</div>
                      </div>
                    ))}

                    {inv.lateFeeMinor > 0 && (
                      <div className="flex items-start justify-between gap-3 border-t pt-2" style={{ borderColor: 'var(--sk-line)' }}>
                        <div>
                          <div className="text-[13px] font-semibold" style={{ color: 'var(--sk-amber-ink)' }}>Late fee</div>
                          {d.lateFeeRule && <div className="text-[11px]" style={{ color: 'var(--sk-ink-3)' }}>{d.lateFeeRule}</div>}
                        </div>
                        <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums" style={{ color: 'var(--sk-amber-ink)' }}>
                          {rupees(inv.lateFeeMinor)}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--sk-line-2)' }}>
                      <span className="text-[13px] font-semibold">{inv.isPaid ? 'Paid in full' : 'Due now'}</span>
                      <span className="text-[17px] font-bold tabular-nums"
                            style={{ color: inv.isPaid ? 'var(--sk-good)' : 'var(--sk-bad)' }}>
                        {rupees(inv.isPaid ? inv.totalMinor : inv.dueMinor)}
                      </span>
                    </div>
                    {inv.paidMinor > 0 && !inv.isPaid && (
                      <p className="text-[11px]" style={{ color: 'var(--sk-good)' }}>
                        {rupees(inv.paidMinor)} already received against this bill.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
      )}

      {tab === 'payments' && (
        d.payments.length === 0
          ? <p className="sk-state">Nothing has been paid or claimed yet.</p>
          : <div className="sk-card"><div className="sk-card-b">
              {d.payments.map((p) => (
                <div key={p.id} className="sk-row">
                  <div className="min-w-0 flex-1">
                    <div className="nm">{rupees(p.amountMinor)} · {METHOD_LABEL[p.method]}</div>
                    <div className="meta">
                      paid {fmtDate(p.paidOn)}
                      {p.providerRef && ` · ref ${p.providerRef}`}
                      {p.receiptNumber && ` · receipt ${p.receiptNumber}`}
                    </div>
                    {p.rejectionReason && (
                      <div className="mt-0.5 text-[11px]" style={{ color: 'var(--sk-bad)' }}>{p.rejectionReason}</div>
                    )}
                  </div>
                  <span className="sk-pill" data-tone={
                    p.status === 'VERIFIED' ? 'good' : p.status === 'SUBMITTED' ? 'warn' : 'bad'
                  }>
                    {p.status === 'VERIFIED' ? 'Confirmed'
                      : p.status === 'SUBMITTED' ? 'Being checked'
                      : p.status === 'REJECTED' ? 'Not accepted' : 'Reversed'}
                  </span>
                </div>
              ))}
            </div></div>
      )}

      {tab === 'ledger' && (
        <div className="sk-card overflow-hidden">
          <div className="sk-card-h">
            <h3>The ledger</h3>
            <p>Append-only. Every correction is an opposing entry, never an edit.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  {['When', 'What', 'Charged', 'Received'].map((h, i) => (
                    <th key={h} className={`p-2 text-[10px] font-bold uppercase tracking-[0.08em] ${i >= 2 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--sk-ink-3)', borderBottom: '1px solid var(--sk-line-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.ledger.map((e, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--sk-line)' }}>
                    <td className="p-2 whitespace-nowrap" style={{ color: 'var(--sk-ink-3)' }}>{fmtDate(e.occurredAt)}</td>
                    <td className="p-2">{e.narration}</td>
                    <td className="p-2 text-right tabular-nums">{e.kind === 'DEBIT' ? rupees(e.amountMinor) : '—'}</td>
                    <td className="p-2 text-right tabular-nums" style={{ color: 'var(--sk-good)' }}>
                      {e.kind === 'CREDIT' ? rupees(e.amountMinor) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--sk-line-2)', background: 'var(--sk-bg-2)' }}>
                  <td className="p-2 font-semibold" colSpan={2}>Balance</td>
                  <td className="p-2 text-right tabular-nums font-semibold">{rupees(d.billedMinor)}</td>
                  <td className="p-2 text-right tabular-nums font-semibold" style={{ color: 'var(--sk-good)' }}>{rupees(d.paidMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {unpaid.length > 0 && tab === 'bills' && (
        <p className="sk-state">
          {unpaid.length} unpaid {unpaid.length === 1 ? 'bill' : 'bills'} · {rupees(d.balanceMinor)} outstanding.
        </p>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}
