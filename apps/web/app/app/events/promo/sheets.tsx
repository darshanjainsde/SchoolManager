'use client';
/**
 * The four printable pieces, drawn as SVG.
 *
 * SVG rather than HTML+CSS, deliberately and for one reason: the SAME node is
 * the on-screen preview, the artwork that goes to the printer, and the file
 * that gets downloaded. An HTML sheet would need a screenshotting library
 * (html2canvas and friends re-implement CSS and get it subtly wrong) to become
 * a PNG or a PDF, and the download would then look unlike the preview. An SVG
 * serialises to a canvas exactly as drawn.
 *
 * Everything is laid out in MILLIMETRES — the viewBox is the real paper — so a
 * 10mm margin is 10mm on paper, and exporting at any DPI is one multiplication.
 *
 * Colours are fixed rather than tokenised: this is ink on white paper, where
 * the console's dark scheme has no meaning.
 */
import { EventArtGroup, type ArtKey } from '../event-art';

export type PieceKey = 'poster' | 'handbill' | 'invite' | 'slips';
export type PaperSize = 'A4' | 'A3';

/** Real paper, in millimetres. */
export const PAPER: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};
/** ID-1 / CR80 — the credit-card size the Print Store already quotes. */
export const CR80 = { w: 85.6, h: 54 };

export const PIECES: Record<PieceKey, { name: string; sizeLabel: string; sizes: PaperSize[]; note: string }> = {
  poster: {
    name: 'Poster', sizeLabel: 'A4 or A3 · portrait', sizes: ['A4', 'A3'],
    note: 'For the gate, the notice board and every classroom door. The QR is how a wall gets people onto the RSVP page.',
  },
  handbill: {
    name: 'Handbill', sizeLabel: 'A5 · four to a sheet', sizes: ['A4'],
    note: 'Goes home in the school bag. Four to a sheet with cut lines, so 500 handbills costs 125 sheets of paper.',
  },
  invite: {
    name: 'Invitation card', sizeLabel: 'CR80 · 85.6 × 54 mm', sizes: ['A4'],
    note: 'For the chief guest, the trustees, the donor who paid for the sound system. Ten to a sheet, on card.',
  },
  slips: {
    name: 'Save-the-date slips', sizeLabel: '10 to a sheet', sizes: ['A4'],
    note: 'Tear-off strips for the front desk. Date, name, QR — nothing else, because nothing else survives a pocket.',
  },
};

export interface SheetData {
  title: string;
  when: string;
  venue: string;
  schoolName: string;
  /** Printed under the QR so the poster still works if the code will not scan. */
  url: string;
  art: ArtKey;
  /** The event's own description, if it has one. Fills the poster's middle. */
  blurb?: string | null;
  /** A data: URL for the QR image, or null while it is still being made. */
  qr: string | null;
}

const INK = '#211d45';
const INK_2 = '#4b4768';
const INK_3 = '#8a87a0';
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

/**
 * Break a title across lines. SVG has no automatic wrapping, so the width has
 * to be estimated — 0.52em per character is a good average for this serif at
 * display sizes. Over-estimating is safer than under: a line that is slightly
 * short looks composed, a line that overflows the page looks broken.
 */
export function wrapTitle(title: string, maxWidthMm: number, fontSizeMm: number, maxLines = 3): string[] {
  const perChar = fontSizeMm * 0.52;
  const limit = Math.max(6, Math.floor(maxWidthMm / perChar));
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > limit && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]$/, '')}…`;
    return kept;
  }
  return lines;
}

function Cut({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#c9c4dd" strokeWidth="0.2" strokeDasharray="2 2" />;
}

function Qr({ src, x, y, size }: { src: string | null; x: number; y: number; size: number }) {
  if (!src) return <rect x={x} y={y} width={size} height={size} fill="#f1eee6" />;
  return <image href={src} x={x} y={y} width={size} height={size} preserveAspectRatio="none" />;
}

// ── Poster ────────────────────────────────────────────────────────────────

function Poster({ d, size }: { d: SheetData; size: PaperSize }) {
  const { w, h } = PAPER[size];
  const pad = w * 0.055;
  const artH = h * 0.5;
  const titleSize = w * 0.095;
  const lines = wrapTitle(d.title, w - pad * 2, titleSize);
  let y = artH + pad * 1.5;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`Poster for ${d.title}`}>
      <rect width={w} height={h} fill="#ffffff" />
      <EventArtGroup kind={d.art} width={w} height={artH} />
      <text x={pad} y={y} fontFamily={SANS} fontSize={w * 0.021} fontWeight="800" letterSpacing={w * 0.004} fill={INK_3}>
        {d.schoolName.toUpperCase()}
      </text>
      {lines.map((ln, i) => {
        y += i === 0 ? titleSize * 0.98 : titleSize * 0.96;
        return (
          <text key={i} x={pad} y={y} fontFamily={SERIF} fontSize={titleSize} fontWeight="650" fill={INK}>
            {ln}
          </text>
        );
      })}
      <text x={pad} y={(y += w * 0.055)} fontFamily={SANS} fontSize={w * 0.032} fontWeight="700" fill={INK}>
        {d.when}
      </text>
      <text x={pad} y={(y += w * 0.038)} fontFamily={SANS} fontSize={w * 0.026} fill={INK_2}>
        {d.venue}
      </text>
      {/* The description fills the middle. Without it a short title left a dead
          band of white between the venue and the footer — a poster reads as
          unfinished rather than composed. Capped at three lines: a notice board
          is read from two metres away, not studied. */}
      {d.blurb
        ? wrapTitle(d.blurb, w - pad * 2, w * 0.028, 3).map((ln, i) => (
            <text key={i} x={pad} y={(y += w * (i === 0 ? 0.055 : 0.04))} fontFamily={SANS} fontSize={w * 0.028} fill={INK_2}>
              {ln}
            </text>
          ))
        : null}
      {/* The footer is pinned to the page, not to the text above it, so a one
          line title and a three line title produce the same poster. */}
      <Qr src={d.qr} x={pad} y={h - pad - w * 0.15} size={w * 0.15} />
      <text x={pad + w * 0.18} y={h - pad - w * 0.105} fontFamily={SANS} fontSize={w * 0.026} fontWeight="700" fill={INK}>
        Scan to say you’re coming
      </text>
      <text x={pad + w * 0.18} y={h - pad - w * 0.065} fontFamily={SANS} fontSize={w * 0.021} fill={INK_2}>
        Seats are limited — tell us and
      </text>
      <text x={pad + w * 0.18} y={h - pad - w * 0.033} fontFamily={SANS} fontSize={w * 0.021} fill={INK_2}>
        we’ll keep one for you.
      </text>
      <text x={pad + w * 0.18} y={h - pad} fontFamily={SANS} fontSize={w * 0.019} fill={INK_3}>
        {d.url}
      </text>
    </svg>
  );
}

// ── Handbill · four A5s on one A4 ─────────────────────────────────────────

function Bill({ d, x, y, w, h }: { d: SheetData; x: number; y: number; w: number; h: number }) {
  const pad = w * 0.075;
  const artH = h * 0.36;
  const titleSize = w * 0.098;
  const lines = wrapTitle(d.title, w - pad * 2, titleSize, 2);
  let ty = artH + pad * 1.3;
  return (
    <g transform={`translate(${x} ${y})`}>
      <svg x="0" y="0" width={w} height={artH} viewBox={`0 0 ${w} ${artH}`}>
        <EventArtGroup kind={d.art} width={w} height={artH} />
      </svg>
      {lines.map((ln, i) => {
        ty += i === 0 ? titleSize : titleSize * 0.95;
        return (
          <text key={i} x={pad} y={ty} fontFamily={SERIF} fontSize={titleSize} fontWeight="650" fill={INK}>
            {ln}
          </text>
        );
      })}
      <text x={pad} y={(ty += h * 0.05)} fontFamily={SANS} fontSize={w * 0.042} fontWeight="700" fill={INK}>
        {d.when}
      </text>
      <text x={pad} y={(ty += h * 0.036)} fontFamily={SANS} fontSize={w * 0.036} fill={INK_2}>
        {d.venue}
      </text>
      <Qr src={d.qr} x={pad} y={h - pad - w * 0.19} size={w * 0.19} />
      <text x={pad + w * 0.23} y={h - pad - w * 0.11} fontFamily={SANS} fontSize={w * 0.038} fontWeight="700" fill={INK}>
        Scan to RSVP
      </text>
      <text x={pad + w * 0.23} y={h - pad - w * 0.055} fontFamily={SANS} fontSize={w * 0.031} fill={INK_2}>
        {d.schoolName}
      </text>
      <text x={pad + w * 0.23} y={h - pad} fontFamily={SANS} fontSize={w * 0.028} fill={INK_3}>
        {d.url}
      </text>
    </g>
  );
}

function Handbills({ d }: { d: SheetData }) {
  const { w, h } = PAPER.A4;
  const cw = w / 2;
  const ch = h / 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`Handbills for ${d.title}`}>
      <rect width={w} height={h} fill="#ffffff" />
      {[0, 1, 2, 3].map((i) => (
        <Bill key={i} d={d} x={(i % 2) * cw} y={Math.floor(i / 2) * ch} w={cw} h={ch} />
      ))}
      <Cut x1={cw} y1={0} x2={cw} y2={h} />
      <Cut x1={0} y1={ch} x2={w} y2={ch} />
    </svg>
  );
}

// ── Invitation cards · ten CR80 on one A4 ─────────────────────────────────

function Invite({ d, x, y }: { d: SheetData; x: number; y: number }) {
  const { w, h } = CR80;
  const artW = w * 0.34;
  const pad = w * 0.055;
  const tx = artW + pad;
  const titleSize = w * 0.105;
  const lines = wrapTitle(d.title, w - artW - pad * 2, titleSize, 2);
  let ty = h * 0.36;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} fill="#ffffff" />
      <svg x="0" y="0" width={artW} height={h} viewBox={`0 0 ${artW} ${h}`}>
        <EventArtGroup kind={d.art} width={artW} height={h} />
      </svg>
      <text x={tx} y={h * 0.22} fontFamily={SANS} fontSize={w * 0.038} fontWeight="800" letterSpacing={w * 0.006} fill={INK_3}>
        YOU ARE INVITED
      </text>
      {lines.map((ln, i) => {
        ty += i === 0 ? 0 : titleSize * 0.95;
        return (
          <text key={i} x={tx} y={ty} fontFamily={SERIF} fontSize={titleSize} fontWeight="650" fill={INK}>
            {ln}
          </text>
        );
      })}
      <text x={tx} y={h * 0.7} fontFamily={SANS} fontSize={w * 0.05} fontWeight="700" fill={INK}>
        {d.when}
      </text>
      <text x={tx} y={h * 0.82} fontFamily={SANS} fontSize={w * 0.042} fill={INK_2}>
        {d.venue}
      </text>
      <text x={tx} y={h * 0.94} fontFamily={SANS} fontSize={w * 0.038} fill={INK_3}>
        {d.schoolName}
      </text>
      <Qr src={d.qr} x={w - pad - h * 0.3} y={h - pad - h * 0.3} size={h * 0.3} />
    </g>
  );
}

function Invites({ d }: { d: SheetData }) {
  const { w, h } = PAPER.A4;
  const cols = 2;
  const rows = 5;
  const gapX = (w - cols * CR80.w) / (cols + 1);
  const gapY = (h - rows * CR80.h) / (rows + 1);
  const cards: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gapX + c * (CR80.w + gapX);
      const y = gapY + r * (CR80.h + gapY);
      cards.push(<Invite key={`${r}-${c}`} d={d} x={x} y={y} />);
      cards.push(
        <rect key={`b${r}-${c}`} x={x} y={y} width={CR80.w} height={CR80.h} fill="none" stroke="#c9c4dd" strokeWidth="0.2" strokeDasharray="2 2" />,
      );
    }
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`Invitation cards for ${d.title}`}>
      <rect width={w} height={h} fill="#ffffff" />
      {cards}
    </svg>
  );
}

// ── Save-the-date slips ───────────────────────────────────────────────────

function Slips({ d }: { d: SheetData }) {
  const { w, h } = PAPER.A4;
  const n = 10;
  const sh = h / n;
  const pad = w * 0.05;
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const y = i * sh;
    rows.push(
      <g key={i} transform={`translate(0 ${y})`}>
        <text x={pad} y={sh * 0.45} fontFamily={SERIF} fontSize={sh * 0.3} fontWeight="650" fill={INK}>
          {wrapTitle(d.title, w * 0.5, sh * 0.3, 1)[0]}
        </text>
        <text x={pad} y={sh * 0.75} fontFamily={SANS} fontSize={sh * 0.19} fill={INK_2}>
          {d.when} · {d.venue}
        </text>
        <Qr src={d.qr} x={w - pad - sh * 0.62} y={sh * 0.19} size={sh * 0.62} />
        <text x={w - pad - sh * 0.72} y={sh * 0.5} textAnchor="end" fontFamily={SANS} fontSize={sh * 0.17} fill={INK_3}>
          {d.schoolName}
        </text>
        <text x={w - pad - sh * 0.72} y={sh * 0.72} textAnchor="end" fontFamily={SANS} fontSize={sh * 0.15} fill={INK_3}>
          {d.url}
        </text>
        {i < n - 1 ? <Cut x1={0} y1={sh} x2={w} y2={sh} /> : null}
      </g>,
    );
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`Save-the-date slips for ${d.title}`}>
      <rect width={w} height={h} fill="#ffffff" />
      {rows}
    </svg>
  );
}

/** The page size a piece actually prints on — what the exporter needs. */
export function piecePaper(piece: PieceKey, size: PaperSize): { w: number; h: number } {
  return piece === 'poster' ? PAPER[size] : PAPER.A4;
}

export function Sheet({ piece, size, data }: { piece: PieceKey; size: PaperSize; data: SheetData }) {
  if (piece === 'poster') return <Poster d={data} size={size} />;
  if (piece === 'handbill') return <Handbills d={data} />;
  if (piece === 'invite') return <Invites d={data} />;
  return <Slips d={data} />;
}
