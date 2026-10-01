'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  BLOCK_ALIGNS,
  CALLOUT_TONES,
  DIVIDER_STYLES,
  IMAGE_WIDTHS,
  PAGE_BLOCK_MAX,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  isSafeBlockUrl,
  type PageBlock,
} from '@/components/public/site-variants';
import { hasMarks } from '@/components/public/page-text';

/**
 * ONE block editor, used by BOTH the custom-page editor and the homepage
 * custom-section editor.
 *
 * It exists because those two screens had the same editor pasted twice. That
 * was survivable while a block had one field; the moment blocks gained
 * options it would have meant writing every control twice and watching the
 * two copies drift — which is exactly how one editor ends up able to centre a
 * heading and the other does not.
 */

export type Block = PageBlock;

export const BLOCK_NAMES: Record<Block['t'], string> = {
  h: 'Heading',
  p: 'Text',
  img: 'Image',
  imgtext: 'Image & text',
  cta: 'Button',
  divider: 'Divider',
  quote: 'Quote',
  callout: 'Callout',
  file: 'File',
  table: 'Table',
};

/** What a freshly added block looks like. */
export function newBlock(t: Block['t']): Block {
  switch (t) {
    case 'h': return { t: 'h', text: '' };
    case 'p': return { t: 'p', text: '' };
    case 'img': return { t: 'img', url: '', caption: null };
    case 'imgtext': return { t: 'imgtext', url: null, text: '' };
    case 'cta': return { t: 'cta', label: 'Learn more', href: null };
    case 'divider': return { t: 'divider' };
    case 'quote': return { t: 'quote', text: '', by: null };
    case 'callout': return { t: 'callout', text: '' };
    case 'file': return { t: 'file', url: '', label: '', note: null };
    case 'table': return { t: 'table', rows: [['', ''], ['', '']], header: true };
  }
}

/**
 * A 24x24 hit area for a glyph that is 12px of ink. Measured, not assumed:
 * the audit harness reported these three at 17x16 on a 390px screen, under the
 * 24px a thumb needs. `grid place-items-center` keeps the glyph optically
 * centred, which padding on a text button does not.
 */
export const ICON_BTN = 'grid h-6 w-6 flex-none place-items-center rounded text-xs leading-none';

const ALIGN_LABEL: Record<string, string> = { LEFT: 'Left', CENTER: 'Centre', RIGHT: 'Right' };
const WIDTH_LABEL: Record<string, string> = { COLUMN: 'Column', WIDE: 'Wide', FULL: 'Full bleed' };
const TONE_LABEL: Record<string, string> = { NOTE: 'Note', WARN: 'Warning', GOOD: 'Good news' };
const DIV_LABEL: Record<string, string> = { RULE: 'Line', SPACE: 'Space', DOTS: 'Dots' };

/** A compact segmented control. 32px tall is the floor inside a dense rail. */
function Seg<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(o.value)}
              className={[
                'sk-press min-h-[32px] rounded-md border px-2 text-[11px] font-semibold transition-colors',
                on ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
              ].join(' ')}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const alignSeg = (b: Extract<Block, { align?: unknown }>, set: (p: Partial<Block>) => void) => (
  <Seg
    label="Position"
    options={BLOCK_ALIGNS.map((v) => ({ value: v, label: ALIGN_LABEL[v] }))}
    value={(b.align ?? 'LEFT') as (typeof BLOCK_ALIGNS)[number]}
    onPick={(v) => set({ align: v === 'LEFT' ? undefined : v } as Partial<Block>)}
  />
);

function TableEditor({ b, set }: { b: Extract<Block, { t: 'table' }>; set: (p: Partial<Block>) => void }) {
  const rows = b.rows;
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const put = (ri: number, ci: number, v: string) =>
    set({ rows: rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) } as Partial<Block>);
  return (
    <div className="mt-1.5">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {Array.from({ length: cols }).map((_, ci) => (
                  <td key={ci} className="p-0.5">
                    <input
                      value={r[ci] ?? ''}
                      onChange={(e) => put(ri, ci, e.target.value)}
                      aria-label={`Row ${ri + 1}, column ${ci + 1}`}
                      placeholder={b.header && ri === 0 ? 'Heading' : ''}
                      className={`h-8 w-full min-w-[5.5rem] rounded border px-1.5 text-xs ${b.header && ri === 0 ? 'border-slate-300 bg-slate-50 font-semibold' : 'border-slate-200'}`}
                    />
                  </td>
                ))}
                <td className="p-0.5">
                  <button
                    type="button"
                    aria-label={`Remove row ${ri + 1}`}
                    disabled={rows.length <= 1}
                    className={`${ICON_BTN} text-rose-400 hover:text-rose-600 disabled:opacity-30`}
                    onClick={() => set({ rows: rows.filter((_, i) => i !== ri) } as Partial<Block>)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={rows.length >= TABLE_MAX_ROWS}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40"
          onClick={() => set({ rows: [...rows, Array.from({ length: cols }, () => '')] } as Partial<Block>)}
        >
          + Row
        </button>
        <button
          type="button"
          disabled={cols >= TABLE_MAX_COLS}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40"
          onClick={() => set({ rows: rows.map((r) => [...r, '']) } as Partial<Block>)}
        >
          + Column
        </button>
        {cols > 1 && (
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
            onClick={() => set({ rows: rows.map((r) => r.slice(0, cols - 1)) } as Partial<Block>)}
          >
            − Column
          </button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
          <input
            type="checkbox"
            checked={b.header === true}
            onChange={(e) => set({ header: e.target.checked ? true : undefined } as Partial<Block>)}
            className="sk-check accent-teal-600"
          />
          First row is a heading
        </label>
      </div>
    </div>
  );
}

export function BlockRow({
  b,
  index,
  total,
  photos,
  onChange,
  onMove,
  onRemove,
}: {
  b: Block;
  index: number;
  total: number;
  photos: { id: string; url: string }[];
  onChange: (patch: Partial<Block>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const set = onChange;
  const urlField = (value: string | null | undefined, placeholder: string) => (
    <>
      <div className="mt-1 flex gap-1.5">
        <Input
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => set({ url: e.target.value } as Partial<Block>)}
          className={`h-8 flex-1 text-xs${value && !isSafeBlockUrl(value) ? ' border-rose-300' : ''}`}
        />
        {photos.length > 0 && (
          <select
            aria-label="Use a gallery photo"
            className="h-8 rounded-md border border-slate-200 text-xs text-slate-500"
            value=""
            onChange={(e) => e.target.value && set({ url: e.target.value } as Partial<Block>)}
          >
            <option value="">Gallery…</option>
            {photos.map((m, j) => (
              <option key={m.id} value={m.url}>
                Photo {j + 1}
              </option>
            ))}
          </select>
        )}
      </div>
      {!!value && !isSafeBlockUrl(value) && (
        <p className="mt-1 text-[10px] text-rose-500">
          Use a full https:// address (or a /path on your site) — anything else is dropped.
        </p>
      )}
    </>
  );

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-center gap-0.5">
        <span className="flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{BLOCK_NAMES[b.t]}</span>
        <button type="button" aria-label="Move up" disabled={index === 0} className={`${ICON_BTN} text-slate-400 hover:text-slate-700 disabled:opacity-30`} onClick={() => onMove(-1)}>▲</button>
        <button type="button" aria-label="Move down" disabled={index === total - 1} className={`${ICON_BTN} text-slate-400 hover:text-slate-700 disabled:opacity-30`} onClick={() => onMove(1)}>▼</button>
        <button type="button" aria-label="Remove block" className={`${ICON_BTN} text-rose-400 hover:text-rose-600`} onClick={onRemove}>✕</button>
      </div>

      {b.t === 'h' && (
        <>
          <Input value={b.text} maxLength={200} placeholder="Heading" onChange={(e) => set({ text: e.target.value })} className="mt-1 h-8 text-sm" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Seg label="Size" options={[{ value: 'H2', label: 'Section' }, { value: 'H3', label: 'Sub-heading' }]} value={b.level === 3 ? 'H3' : 'H2'} onPick={(v) => set({ level: v === 'H3' ? 3 : undefined } as Partial<Block>)} />
            {alignSeg(b, set)}
          </div>
        </>
      )}

      {b.t === 'p' && (
        <>
          <Textarea value={b.text} rows={3} placeholder="Write something…" onChange={(e) => set({ text: e.target.value })} className="mt-1 text-sm" />
          <p className="mt-1 text-[10px] text-slate-400">
            {hasMarks(b.text)
              ? 'Formatting is on: **bold**, *italic*, [link](/contact), and lines starting with - or 1.'
              : 'You can use **bold**, *italic*, [link](/contact), and start a line with - or 1. for a list.'}
          </p>
          <div className="mt-2">{alignSeg(b, set)}</div>
        </>
      )}

      {b.t === 'img' && (
        <>
          {urlField(b.url, 'https://… image URL')}
          <Input value={b.caption ?? ''} maxLength={200} placeholder="Caption (optional)" onChange={(e) => set({ caption: e.target.value || null } as Partial<Block>)} className="mt-1.5 h-8 text-xs" />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Seg label="Show" options={[{ value: 'COVER', label: 'Crop to a band' }, { value: 'CONTAIN', label: 'Fit it all in' }]} value={b.fit === 'CONTAIN' ? 'CONTAIN' : 'COVER'} onPick={(v) => set({ fit: v === 'CONTAIN' ? 'CONTAIN' : undefined } as Partial<Block>)} />
            <Seg label="Width" options={IMAGE_WIDTHS.map((v) => ({ value: v, label: WIDTH_LABEL[v] }))} value={b.width ?? 'WIDE'} onPick={(v) => set({ width: v === 'WIDE' ? undefined : v } as Partial<Block>)} />
          </div>
          {(b.width ?? 'WIDE') === 'COLUMN' && <div className="mt-2">{alignSeg(b, set)}</div>}
        </>
      )}

      {b.t === 'imgtext' && (
        <>
          <Textarea value={b.text} rows={2} placeholder="Write something…" onChange={(e) => set({ text: e.target.value })} className="mt-1 text-sm" />
          {urlField(b.url, 'https://… image URL')}
          <div className="mt-2">
            <Seg label="Picture on the" options={[{ value: 'L', label: 'Left' }, { value: 'R', label: 'Right' }]} value={b.flip ? 'R' : 'L'} onPick={(v) => set({ flip: v === 'R' ? true : undefined } as Partial<Block>)} />
          </div>
        </>
      )}

      {b.t === 'cta' && (
        <>
          <Input value={b.label} maxLength={80} placeholder="Button label" onChange={(e) => set({ label: e.target.value })} className="mt-1 h-8 text-sm" />
          <Input value={b.href ?? ''} placeholder="/contact  or  https://…" onChange={(e) => set({ href: e.target.value || null } as Partial<Block>)} className="mt-1.5 h-8 text-xs" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Seg label="Style" options={[{ value: 'SOLID', label: 'Solid' }, { value: 'GHOST', label: 'Outline' }]} value={b.style === 'GHOST' ? 'GHOST' : 'SOLID'} onPick={(v) => set({ style: v === 'GHOST' ? 'GHOST' : undefined } as Partial<Block>)} />
            {alignSeg(b, set)}
          </div>
        </>
      )}

      {b.t === 'divider' && (
        <div className="mt-1.5">
          <Seg label="Style" options={DIVIDER_STYLES.map((v) => ({ value: v, label: DIV_LABEL[v] }))} value={b.style ?? 'RULE'} onPick={(v) => set({ style: v === 'RULE' ? undefined : v } as Partial<Block>)} />
        </div>
      )}

      {b.t === 'quote' && (
        <>
          <Textarea value={b.text} rows={2} maxLength={600} placeholder="“Every child is known here, by somebody, every day.”" onChange={(e) => set({ text: e.target.value })} className="mt-1 text-sm" />
          <Input value={b.by ?? ''} maxLength={120} placeholder="Who said it (optional)" onChange={(e) => set({ by: e.target.value || null } as Partial<Block>)} className="mt-1.5 h-8 text-xs" />
        </>
      )}

      {b.t === 'callout' && (
        <>
          <Textarea value={b.text} rows={2} maxLength={1000} placeholder="The one sentence that matters most on this page." onChange={(e) => set({ text: e.target.value })} className="mt-1 text-sm" />
          <div className="mt-2">
            <Seg label="Tone" options={CALLOUT_TONES.map((v) => ({ value: v, label: TONE_LABEL[v] }))} value={b.tone ?? 'NOTE'} onPick={(v) => set({ tone: v === 'NOTE' ? undefined : v } as Partial<Block>)} />
          </div>
        </>
      )}

      {b.t === 'file' && (
        <>
          <Input value={b.label} maxLength={120} placeholder="Route map 2027–28" onChange={(e) => set({ label: e.target.value })} className="mt-1 h-8 text-sm" />
          {urlField(b.url, 'https://… link to the PDF')}
          <Input value={b.note ?? ''} maxLength={60} placeholder="PDF · 1.2 MB (optional)" onChange={(e) => set({ note: e.target.value || null } as Partial<Block>)} className="mt-1.5 h-8 text-xs" />
        </>
      )}

      {b.t === 'table' && <TableEditor b={b} set={set} />}
    </div>
  );
}

/** The palette. Grouped so a long list does not read as one wall of buttons. */
const GROUPS: { label: string; types: Block['t'][] }[] = [
  { label: 'Words', types: ['h', 'p', 'quote', 'callout'] },
  { label: 'Pictures & files', types: ['img', 'imgtext', 'file'] },
  { label: 'Arrangement', types: ['divider', 'table', 'cta'] },
];

export function BlockPalette({ count, onAdd }: { count: number; onAdd: (t: Block['t']) => void }) {
  const full = count >= PAGE_BLOCK_MAX;
  return (
    <div className="flex flex-col gap-1.5">
      {GROUPS.map((g) => (
        <div key={g.label} className="flex flex-wrap items-center gap-1.5">
          <span className="w-full text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:w-auto sm:min-w-[7.5rem]">{g.label}</span>
          {g.types.map((t) => (
            <button
              key={t}
              type="button"
              disabled={full}
              className="sk-press min-h-[32px] rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40"
              onClick={() => !full && onAdd(t)}
            >
              + {BLOCK_NAMES[t]}
            </button>
          ))}
        </div>
      ))}
      {full && <p className="text-[10px] text-slate-400">That is {PAGE_BLOCK_MAX} blocks — the most one page holds.</p>}
    </div>
  );
}
