/**
 * Turning a rendered sheet into a file somebody can use.
 *
 * The sheets are SVG laid out in millimetres, which makes all three exports the
 * same two steps: serialise the node, then draw it onto a canvas at whatever
 * density the destination wants. Nothing re-implements CSS, so the download
 * cannot disagree with the preview — that is the entire reason the sheets are
 * not HTML.
 *
 * `jspdf` and `qrcode` are BOTH dynamically imported. Neither belongs in the
 * console's main bundle: an admin who never opens the Promo Kit should never
 * pay for them, and an admin who opens it but only looks should not pay for
 * the PDF writer either.
 */

/** 300 dpi is the floor a commercial printer will accept without complaining. */
export const PRINT_DPI = 300;
const MM_PER_INCH = 25.4;

/**
 * A standalone SVG string.
 *
 * `<image>` hrefs are already data: URLs (the QR) and the fonts are system
 * faces, so the result has no external references and rasterises in isolation.
 */
function serialise(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return new XMLSerializer().serializeToString(clone);
}

/** Rasterise a sheet at a given pixel size. Resolves once the bitmap is drawn. */
async function toCanvas(svg: SVGSVGElement, pxW: number, pxH: number): Promise<HTMLCanvasElement> {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialise(svg))}`;
  const img = new Image();
  // Not strictly needed for a data: URL, but it keeps the canvas untainted if a
  // future sheet ever references anything else.
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The sheet could not be rendered.'));
    img.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pxW);
  canvas.height = Math.round(pxH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give us a canvas to draw on.');
  // Paper is white. Without this the PNG has a transparent ground and prints
  // grey on anything that composites it onto its own background.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function download(blobUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** `Annual Day 2026` + `poster` → `annual-day-2026-poster`. */
export function fileStem(title: string, piece: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${slug || 'event'}-${piece}`;
}

export async function downloadPng(
  svg: SVGSVGElement,
  paper: { w: number; h: number },
  filename: string,
): Promise<void> {
  const px = (mm: number) => (mm / MM_PER_INCH) * PRINT_DPI;
  const canvas = await toCanvas(svg, px(paper.w), px(paper.h));
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('The image could not be saved.');
  const url = URL.createObjectURL(blob);
  download(url, `${filename}.png`);
  // Revoked on the next tick: Safari has not finished reading the blob when
  // click() returns, and revoking synchronously produces an empty file.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadPdf(
  svg: SVGSVGElement,
  paper: { w: number; h: number },
  filename: string,
): Promise<void> {
  const px = (mm: number) => (mm / MM_PER_INCH) * PRINT_DPI;
  const canvas = await toCanvas(svg, px(paper.w), px(paper.h));
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: paper.w > paper.h ? 'landscape' : 'portrait',
    unit: 'mm',
    // The page IS the paper — no scaling, no margins invented by the writer.
    format: [paper.w, paper.h],
    compress: true,
  });
  doc.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, paper.w, paper.h);
  doc.save(`${filename}.pdf`);
}

/**
 * The QR, as a data: URL so it can live inside the SVG and survive
 * serialisation. Errors are swallowed to null rather than thrown: a poster
 * without a QR is still a poster, and it prints the URL underneath anyway.
 */
export async function makeQr(url: string): Promise<string | null> {
  try {
    const QR = await import('qrcode');
    return await QR.toDataURL(url, {
      margin: 1,
      width: 512,
      errorCorrectionLevel: 'M',
      color: { dark: '#211d45ff', light: '#ffffffff' },
    });
  } catch {
    return null;
  }
}

/**
 * A remote image as a data: URL.
 *
 * The sheets are exported by serialising the SVG and rasterising it in an
 * isolated context, where an EXTERNAL `<image href>` does not load — the
 * school's photograph would be there on screen and missing from the file, a
 * failure nobody would notice until the poster came off the printer with a
 * white rectangle in it. So the photo is inlined before it ever reaches a
 * sheet.
 *
 * Returns null rather than throwing when the fetch is refused (a bucket with
 * no CORS header will), so the caller can fall back to the drawn artwork and
 * say why instead of producing a broken sheet.
 */
export async function inlineImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
