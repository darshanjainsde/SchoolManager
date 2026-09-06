'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import type { PrintOrderDetail } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { Z } from '@/lib/z-layers';

/**
 * "Print via Sckools" — the order form, one drawer for both kinds:
 *   - a report-card batch (from the batch page, issued cards only), or
 *   - an uploaded PDF (from the orders desk — exam papers, circulars, forms).
 *
 * The school picks paper + finish + quantity and sends it; Sckools answers
 * with a price and a promised date on the order's own page. Portaled to
 * <body> with .skosx (the RecordPaymentDialog lesson — `.sk-anim > *` leaves
 * persistent sibling stacking contexts, so an inline fixed drawer loses).
 */

export type OrderTarget =
  | { kind: 'REPORT_CARDS'; windowId: string; classSectionId: string; issuedCount: number; batchLabel: string }
  | { kind: 'UPLOAD' };

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

const MAX_ORDER_PDF_BYTES = 25 * 1024 * 1024;

export function OrderDrawer({ target, onClose }: { target: OrderTarget; onClose: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [quantity, setQuantity] = useState(target.kind === 'REPORT_CARDS' ? 1 : 100);
  const [size, setSize] = useState('A4');
  const [colour, setColour] = useState('COLOUR');
  const [sides, setSides] = useState('DOUBLE');
  const [gsm, setGsm] = useState(target.kind === 'REPORT_CARDS' ? 170 : 80);
  const [finish, setFinish] = useState('NONE');
  const [neededBy, setNeededBy] = useState('');
  const [note, setNote] = useState('');

  const send = useMutation({
    mutationFn: async (): Promise<PrintOrderDetail> => {
      const spec = { quantity, size, colour, sides, gsm, finish, ...(neededBy ? { neededBy } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
      if (target.kind === 'REPORT_CARDS') {
        return api.post<PrintOrderDetail>('/manage/press/orders/report-cards', {
          windowId: target.windowId, classSectionId: target.classSectionId, ...spec,
        });
      }
      // Multipart sends every scalar as a string — the DTO coerces (the
      // RecordPayment lesson), so plain appends are fine here.
      const form = new FormData();
      form.append('file', file!);
      form.append('title', title.trim());
      for (const [k, v] of Object.entries(spec)) form.append(k, String(v));
      return api.postForm<PrintOrderDetail>('/manage/press/orders/upload', form);
    },
    onSuccess: (order) => {
      onClose();
      toast.success('Sent to Sckools — the quote lands on this order.');
      router.push(`/app/press/orders/${order.id}`);
    },
    onError: (e) => {
      // A storage outage is nobody's fault at this desk — say what happened
      // and that nothing was ordered, rather than a shrug.
      const code = e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined;
      if (code === 'STORAGE_UNAVAILABLE') {
        toast.error(e.message, { duration: 8000 });
        return;
      }
      toast.error(e instanceof ApiError ? e.message : 'The order did not send.');
    },
  });

  const fileProblem =
    target.kind === 'UPLOAD' && file
      ? file.type !== 'application/pdf'
        ? 'Only PDFs print faithfully — export the document as PDF first.'
        : file.size > MAX_ORDER_PDF_BYTES
          ? 'That PDF is over 25 MB — compress it and try again.'
          : null
      : null;

  const ready =
    !send.isPending && quantity >= 1 &&
    (target.kind === 'REPORT_CARDS' || (title.trim().length >= 2 && !!file && !fileProblem));

  return createPortal(
    <div className="skosx" style={{ position: 'fixed', inset: 0, zIndex: Z.OVERLAY }}>
      <button aria-label="Close" onClick={onClose}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'rgba(15,14,30,0.45)', border: 'none', cursor: 'default' }} />
      <div role="dialog" aria-modal="true" aria-label="Print via Sckools"
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 420, maxWidth: '94vw',
          background: 'var(--sk-card)', color: 'var(--sk-ink)', borderLeft: '1px solid var(--sk-line)',
          padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14,
        }}>
        <div className="sk-wrap-sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <b style={{ fontSize: 15 }}>Print via Sckools</b>
          <button className="sk-btn" data-icon aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>

        {target.kind === 'REPORT_CARDS' ? (
          <p className="sk-muted" style={{ fontSize: 12.5, margin: 0 }}>
            <b>{target.batchLabel}</b> — the {target.issuedCount} issued card{target.issuedCount === 1 ? '' : 's'} in
            the register, printed exactly as issued and delivered to the school. You&rsquo;ll get a price and a
            delivery date to confirm first.
          </p>
        ) : (
          <>
            <label style={field}>What is it?
              <input className="sk-input" autoFocus maxLength={120} value={title}
                onChange={(e) => setTitle(e.target.value)} placeholder="Term I Maths question paper" />
            </label>
            <label style={field}>The PDF
              <input type="file" accept="application/pdf" className="sk-input"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {fileProblem && <p className="sk-state err" style={{ margin: 0 }}>{fileProblem}</p>}
            {file && !fileProblem && (
              <p className="sk-muted" style={{ fontSize: 11.5, margin: 0 }}>
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB — kept private, opened only by the press.
              </p>
            )}
          </>
        )}

        <label style={field}>{target.kind === 'REPORT_CARDS' ? 'Copies of the set' : 'Copies'}
          <input type="number" className="sk-input" min={1} max={5000} value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))} />
        </label>

        <div style={row}>
          <label style={field}>Paper size
            <select className="sk-input" value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="A4">A4</option><option value="A5">A5</option><option value="A3">A3</option>
              <option value="CR80">Card (CR80)</option>
            </select>
          </label>
          <label style={field}>Colour
            <select className="sk-input" value={colour} onChange={(e) => setColour(e.target.value)}>
              <option value="COLOUR">Colour</option><option value="BW">Black &amp; white</option>
            </select>
          </label>
          <label style={field}>Sides
            <select className="sk-input" value={sides} onChange={(e) => setSides(e.target.value)}>
              <option value="DOUBLE">Both sides</option><option value="SINGLE">One side</option>
            </select>
          </label>
          <label style={field}>Paper (gsm)
            <select className="sk-input" value={gsm} onChange={(e) => setGsm(Number(e.target.value))}>
              <option value={80}>80 — everyday</option>
              <option value={100}>100 — letterhead</option>
              <option value={130}>130 — flyer</option>
              <option value={170}>170 — card stock</option>
              <option value={250}>250 — certificate</option>
              <option value={300}>300 — heavy card</option>
            </select>
          </label>
          <label style={field}>Finish
            <select className="sk-input" value={finish} onChange={(e) => setFinish(e.target.value)}>
              <option value="NONE">None</option>
              <option value="STAPLE">Stapled</option>
              <option value="SPIRAL">Spiral-bound</option>
              <option value="SADDLE">Saddle-stitched</option>
              <option value="LAMINATE">Laminated</option>
            </select>
          </label>
          <label style={field}>Needed by (optional)
            <input type="date" className="sk-input" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </label>
        </div>

        <label style={field}>Note to the press (optional)
          <textarea className="sk-input" rows={2} maxLength={500} value={note}
            onChange={(e) => setNote(e.target.value)} style={{ resize: 'vertical' }}
            placeholder="Sealed bundle per class, please." />
        </label>

        <button className="sk-btn" data-variant="primary" disabled={!ready} onClick={() => send.mutate()}>
          {send.isPending ? 'Sending…' : 'Request a quote'}
        </button>
        <p className="sk-muted" style={{ fontSize: 11.5, margin: 0 }}>
          Nothing prints yet — Sckools quotes a price and a delivery date, and printing starts only after you confirm.
        </p>
      </div>
    </div>,
    document.body,
  );
}
