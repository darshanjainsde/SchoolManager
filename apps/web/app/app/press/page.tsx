'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BookMarked, GraduationCap, ScrollText, Search } from 'lucide-react';
import type { PressOverview, PressIssueRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { PRESS_TYPE_LABEL, pressDateLabel } from '@/lib/press';

/**
 * Reports & Documents — the school's paper desk.
 *
 * One search on top (most visits are about ONE child or one serial), then
 * three desks with a live fact each. Printing-as-a-service lives in its own
 * tab now (Print Store, /app/press/orders) — this page is about the
 * DOCUMENTS: report cards, certificates, and the register they live in.
 *
 * The per-class readiness view that used to sit here moved into the Result
 * Room outright — one screen owns "are the cards done?", not two.
 */

type StudentHit = { id: string; name: string; admissionNo: string; classLabel: string | null; isActive: boolean };

export default function ReportsDocumentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const overview = useQuery({
    queryKey: ['press-overview', host], enabled: !!host,
    queryFn: () => api.get<PressOverview>('/manage/press/overview'),
  });

  const [q, setQ] = useState('');
  const query = q.trim();
  const students = useQuery({
    queryKey: ['press-student-search', host, query], enabled: !!host && query.length >= 2,
    queryFn: () => api.get<StudentHit[]>(`/manage/press/students?q=${encodeURIComponent(query)}`),
  });
  const serials = useQuery({
    queryKey: ['press-serial-search', host, query], enabled: !!host && query.length >= 3,
    queryFn: () => api.get<{ items: PressIssueRow[] }>(`/manage/press/register?q=${encodeURIComponent(query)}`),
  });

  const o = overview.data;
  const term = o?.classes.filter((c) => c.students > 0) ?? [];
  const termIssued = term.reduce((n, c) => n + Math.min(c.issued, c.students), 0);
  const termTotal = term.reduce((n, c) => n + c.students, 0);

  const tiles = [
    {
      href: '/app/press/results', icon: GraduationCap, bg: 'var(--sk-brand-2)',
      name: 'Result Room',
      fact: termTotal > 0
        ? `${termIssued} of ${termTotal} cards issued this term`
        : 'readiness, nudges, generate',
    },
    {
      href: '/app/press/certificates', icon: ScrollText, bg: 'var(--sk-amber)',
      name: 'Certificates',
      fact: o?.certificates.lastSerial
        ? `last ${o.certificates.lastSerial} · ${o.certificates.thisYear} this year`
        : 'TC (Annexure-I), bonafide, character',
    },
    {
      href: '/app/press/register', icon: BookMarked, bg: 'var(--sk-ink-2)',
      name: 'The register',
      fact: o ? `${o.register.total} documents · view & reprint any` : 'every document ever issued',
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead">
        <h1>Reports &amp; Documents</h1>
        <p>Report cards, certificates, and the serial-numbered register they live in.</p>
      </header>

      {/* ── the counter ──────────────────────────────────────────────────── */}
      <div className="sk-card">
        <div className="sk-card-b">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={15} style={{ color: 'var(--sk-ink-3)', flex: 'none' }} aria-hidden="true" />
            <input
              className="sk-input" style={{ flex: 1 }} autoComplete="off"
              placeholder="Type a child's name, admission no., or a serial — certificates and reprints start here"
              value={q} onChange={(e) => setQ(e.target.value)}
            />
          </label>

          {query.length >= 2 && (students.data?.length || serials.data?.items.length) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(students.data ?? []).slice(0, 4).map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180 }}>
                    <b style={{ fontSize: 13.5 }}>{h.name}</b>
                    <span className="sk-muted" style={{ fontSize: 12 }}>
                      {' '}· {h.classLabel ?? 'no class'} · Adm {h.admissionNo}{h.isActive ? '' : ' · left'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Link className="sk-btn" data-variant="primary" style={{ padding: '5px 10px', fontSize: 12 }}
                      href={`/app/press/certificates?q=${encodeURIComponent(h.admissionNo)}`}>
                      New certificate
                    </Link>
                    <Link className="sk-btn" style={{ padding: '5px 10px', fontSize: 12 }}
                      href={`/app/press/register?q=${encodeURIComponent(h.admissionNo)}`}>
                      Their documents
                    </Link>
                    <Link className="sk-btn" style={{ padding: '5px 10px', fontSize: 12 }} href={`/app/students/${h.id}`}>
                      Student 360
                    </Link>
                  </div>
                </div>
              ))}
              {(serials.data?.items ?? []).slice(0, 3).map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180 }}>
                    <b className="sk-num" style={{ fontSize: 13 }}>{it.serial}</b>
                    <span className="sk-muted" style={{ fontSize: 12 }}>
                      {' '}· {PRESS_TYPE_LABEL[it.type]} · {it.studentName} · {pressDateLabel(it.issuedAt)}
                      {it.voidedAt ? ' · VOID' : ''}
                    </span>
                  </div>
                  <Link className="sk-btn" style={{ padding: '5px 10px', fontSize: 12 }}
                    href={`/app/press/register?q=${encodeURIComponent(it.serial)}`}>
                    Open in the register
                  </Link>
                </div>
              ))}
            </div>
          ) : null}
          {query.length >= 2 && students.data && students.data.length === 0 && (serials.data?.items.length ?? 0) === 0 && (
            <p className="sk-state">Nobody and no serial matches — try a shorter part of the name.</p>
          )}
        </div>
      </div>

      {/* ── the three desks — one row, one live fact each ────────────────── */}
      <div className="sk-cardgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="sk-entity sk-press" style={{ minHeight: 76 }}>
            <span className="av" style={{ background: t.bg }}><t.icon size={20} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="nm" style={{ whiteSpace: 'nowrap' }}>{t.name}</div>
              <div className="meta">{t.fact}</div>
            </div>
            <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
          </Link>
        ))}
      </div>

      <p className="sk-state" style={{ margin: 0 }}>
        Looking for printing? Bulk report-card runs, exam papers and deliveries live in the{' '}
        <Link href="/app/press/orders" style={{ color: 'var(--sk-brand-2)' }}>Print Store</Link>
        {(o?.orders.awaitingConfirm ?? 0) > 0 && (
          <> — <b style={{ color: 'var(--sk-amber)' }}>{o!.orders.awaitingConfirm} quote{o!.orders.awaitingConfirm === 1 ? '' : 's'} waiting for you</b></>
        )}.
      </p>
    </div>
  );
}
