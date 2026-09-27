'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, GraduationCap, Printer, ScrollText, Search } from 'lucide-react';
import type { PressOverview, PressIssueRow, PressRegisterPage } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { PRESS_TYPE_LABEL, pressDateLabel } from '@/lib/press';
import { HubDoor, HubDoors, HubKpi, HubKpis, HubList, HubPage } from '@/components/ui/hub';
import { Cell, Row, RowTitle } from '@/components/ui/kit';

/**
 * Reports & Documents — the school's paper desk, as a hub.
 *
 * The counter (one search) stays first: most visits are about ONE child or
 * one serial. Then the numbers, the four desks — the Print Store is a door
 * now, not a footnote — and the last documents issued, so the register is
 * visible from here rather than only findable.
 *
 * The per-class readiness view lives in the Result Room outright — one
 * screen owns "are the cards done?", not two.
 */

type StudentHit = { id: string; name: string; admissionNo: string; classLabel: string | null; isActive: boolean };

export default function ReportsDocumentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const overview = useQuery({
    queryKey: ['press-overview', host], enabled: !!host,
    queryFn: () => api.get<PressOverview>('/manage/press/overview'),
  });
  const recent = useQuery({
    queryKey: ['press-register-recent', host], enabled: !!host,
    queryFn: () => api.get<PressRegisterPage>('/manage/press/register'),
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
  const waiting = o?.orders.awaitingConfirm ?? 0;
  const issued = (recent.data?.items ?? []).slice(0, 8);

  return (
    <HubPage
      title={<>Reports &amp; Documents</>}
      subtitle="Report cards, certificates, and the serial-numbered register they live in."
      action={<Link href="/app/press/certificates" className="sk-btn sk-press" data-variant="primary">Issue a certificate</Link>}
    >
      {/* ── the counter ──────────────────────────────────────────────────── */}
      <div className="sk-card">
        <div className="sk-card-b">
          <label className="sk-wrap-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

      {overview.isError && <p className="sk-state err">The desk could not load its numbers. Refresh to try again.</p>}

      {/* ── the numbers ──────────────────────────────────────────────────── */}
      {o && (
        <HubKpis>
          <HubKpi
            href="/app/press/results" label="Cards issued this term"
            value={termTotal > 0 ? <>{termIssued.toLocaleString('en-IN')} <span className="u">of {termTotal.toLocaleString('en-IN')}</span></> : '—'}
            hint={termTotal > 0 ? `${(termTotal - termIssued).toLocaleString('en-IN')} still to issue` : 'no term open'}
            tone={termTotal > 0 && termIssued === termTotal ? 'good' : undefined}
          />
          <HubKpi
            href="/app/press/certificates" label="Certificates this year" value={o.certificates.thisYear}
            hint={o.certificates.lastSerial ? `last ${o.certificates.lastSerial}` : 'none yet'}
          />
          <HubKpi href="/app/press/register" label="In the register" value={o.register.total.toLocaleString('en-IN')} hint={o.register.lastSerial ? `last ${o.register.lastSerial}` : 'every document ever issued'} />
          <HubKpi
            href="/app/press/orders" label="Print orders open" value={o.orders.open}
            hint={waiting > 0 ? `${waiting} ${waiting === 1 ? 'quote' : 'quotes'} waiting for you` : 'nothing waiting on you'}
            tone={waiting > 0 ? 'warn' : undefined}
          />
        </HubKpis>
      )}

      {/* ── the four desks — one row, one live fact each ─────────────────── */}
      <HubDoors>
        <HubDoor
          href="/app/press/results" icon={GraduationCap} tint="var(--sk-brand-2)" title="Result Room"
          meta={termTotal > 0 ? `${termIssued} of ${termTotal} cards issued this term` : 'readiness, nudges, generate'}
        />
        <HubDoor
          href="/app/press/certificates" icon={ScrollText} tint="var(--sk-amber)" title="Certificates"
          meta={o?.certificates.lastSerial ? `last ${o.certificates.lastSerial} · ${o.certificates.thisYear} this year` : 'TC (Annexure-I), bonafide, character'}
        />
        <HubDoor
          href="/app/press/register" icon={BookMarked} tint="var(--sk-ink-2)" title="The register"
          meta={o ? `${o.register.total.toLocaleString('en-IN')} documents · view & reprint any` : 'every document ever issued'}
        />
        <HubDoor
          href="/app/press/orders" icon={Printer} tint="var(--sk-good)" title="Print Store"
          meta={waiting > 0
            ? `${waiting} ${waiting === 1 ? 'quote' : 'quotes'} waiting for you`
            : o ? `${o.orders.open} ${o.orders.open === 1 ? 'order' : 'orders'} open · bulk runs, exam papers` : 'bulk report cards, exam papers, delivered'}
        />
      </HubDoors>

      {/* ── the last documents issued ────────────────────────────────────── */}
      <HubList
        title="Recently issued" label="Recently issued"
        more={{ href: '/app/press/register', label: 'The register' }}
        columns="minmax(0, 1.6fr) minmax(0, 1fr) auto auto"
        count={issued.length}
        empty={recent.isLoading ? 'Opening the register…' : recent.isError ? 'The register could not load.' : 'Nothing issued yet. The first report card or certificate goes into the register with a serial, and shows here.'}
      >
        {issued.map((it) => (
          <Row key={it.id}>
            <Cell>
              <Link href={`/app/press/register?q=${encodeURIComponent(it.serial)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <RowTitle title={<span className="sk-num">{it.serial}</span>} sub={it.studentName} />
              </Link>
            </Cell>
            <Cell><span style={{ fontSize: 13 }}>{PRESS_TYPE_LABEL[it.type]}</span></Cell>
            <Cell align="end"><span className="sk-pill" data-tone={it.voidedAt ? 'neutral' : 'good'}>{it.voidedAt ? 'Void' : 'Issued'}</span></Cell>
            <Cell align="end"><span className="sk-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{pressDateLabel(it.issuedAt)}</span></Cell>
          </Row>
        ))}
      </HubList>
    </HubPage>
  );
}
