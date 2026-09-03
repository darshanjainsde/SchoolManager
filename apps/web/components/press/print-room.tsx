'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import type { CertificateSnapshot, ReportCardSnapshot } from '@skoolos/types';
import {
  getPressTemplate, PRESS_TEMPLATES, printPressSheets, setPressTemplate, type PressTemplate,
} from '@/lib/press';
import { CertificateSheet, ReportCardSheet } from './press-sheets';
import { Z } from '@/lib/z-layers';
import { PressPrintPortal } from './press-print-portal';
import './press-print.css';

/**
 * The Print Room — see the paper before the paper.
 *
 * A full-screen viewer for any set of Press sheets: readable size, flip
 * through a batch, switch the report-card template, and Print only from
 * here — the same sheets it shows are the ones mounted in the print portal,
 * so what you see is byte-for-byte what comes out. No document meets the
 * printer blind any more.
 *
 * Portaled to <body> with .skosx (the standing overlay rule: `.sk-anim > *`
 * leaves persistent sibling stacking contexts, so an inline fixed viewer
 * would lose to the page).
 */

export type PrintRoomSheet =
  | { kind: 'REPORT_CARD'; snapshot: ReportCardSnapshot; serial?: string; stamp?: 'PROOF' | 'DUPLICATE' | 'CANCELLED' }
  | { kind: 'CERTIFICATE'; snapshot: CertificateSnapshot; serial: string; issuedAt: string; stamp?: 'DUPLICATE' | 'CANCELLED' };

const ZOOMS = [0.6, 0.8, 1] as const;

export function PrintRoom({ sheets, startIndex = 0, title, onClose }: {
  sheets: PrintRoomSheet[];
  startIndex?: number;
  title: string;
  onClose: () => void;
}) {
  const [i, setI] = useState(Math.min(startIndex, sheets.length - 1));
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(0.8);
  const [template, setTemplate] = useState<PressTemplate>('DETAILED');
  useEffect(() => { setTemplate(getPressTemplate()); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((v) => Math.min(v + 1, sheets.length - 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sheets.length]);

  const current = sheets[i];
  if (!current) return null;
  const hasCards = sheets.some((s) => s.kind === 'REPORT_CARD');

  const renderSheet = (sh: PrintRoomSheet, key: React.Key) =>
    sh.kind === 'REPORT_CARD' ? (
      <ReportCardSheet key={key} snapshot={sh.snapshot} serial={sh.serial} stamp={sh.stamp} template={template} />
    ) : (
      <CertificateSheet key={key} snapshot={sh.snapshot} serial={sh.serial} issuedAt={sh.issuedAt} stamp={sh.stamp} />
    );

  return createPortal(
    <div className="skosx" style={{ position: 'fixed', inset: 0, zIndex: Z.VIEWER, display: 'flex', flexDirection: 'column', background: 'rgba(15,14,30,0.82)' }}>
      {/* ── the controls bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', flexWrap: 'wrap', color: '#EDECF6' }}>
        <b style={{ fontSize: 13.5 }}>{title}</b>
        {sheets.length > 1 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
            <button className="sk-btn" data-icon aria-label="Previous sheet" disabled={i === 0}
              onClick={() => setI((v) => v - 1)}><ChevronLeft size={14} /></button>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{i + 1} / {sheets.length}</span>
            <button className="sk-btn" data-icon aria-label="Next sheet" disabled={i === sheets.length - 1}
              onClick={() => setI((v) => v + 1)}><ChevronRight size={14} /></button>
          </span>
        )}
        {hasCards && (
          <select
            aria-label="Report card template"
            className="sk-input" style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }}
            value={template}
            onChange={(e) => { const t = e.target.value as PressTemplate; setTemplate(t); setPressTemplate(t); }}
          >
            {PRESS_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        <select aria-label="Zoom" className="sk-input" style={{ width: 'auto', fontSize: 12, padding: '5px 8px' }}
          value={zoom} onChange={(e) => setZoom(Number(e.target.value) as (typeof ZOOMS)[number])}>
          {ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, opacity: 0.75 }}>
            Print{sheets.length > 1 ? `s all ${sheets.length}` : 's this sheet'} — exactly as shown
          </span>
          <button className="sk-btn" data-variant="primary" onClick={printPressSheets}>
            <Printer size={14} aria-hidden="true" /> Print
          </button>
          <button className="sk-btn" data-icon aria-label="Close the print room" onClick={onClose}><X size={15} /></button>
        </span>
      </div>

      {/* ── the paper ── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '8px 16px 24px' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', height: `calc(297mm * ${zoom})`, flex: 'none' }}>
          <div style={{ boxShadow: '0 18px 50px rgba(0,0,0,0.5)' }}>
            {renderSheet(current, current.kind === 'CERTIFICATE' || current.serial ? (current as { serial?: string }).serial ?? i : i)}
          </div>
        </div>
      </div>

      {/* the print source: the SAME sheets, mounted for the printer */}
      <PressPrintPortal>
        {sheets.map((sh, k) => renderSheet(sh, k))}
      </PressPrintPortal>
    </div>,
    document.body,
  );
}
