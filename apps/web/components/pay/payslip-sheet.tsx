'use client';
import { useState } from 'react';
import { PAYSLIP_CSS, payslipBody, payslipFileName, payslipHtml, type PayslipDoc } from '@skoolos/types';
import { BodyPrintPortal } from '@/components/press/press-print-portal';
import './payslip-print.css';

/**
 * A PAYSLIP, WITH THE TWO THINGS A PERSON ACTUALLY WANTS TO DO TO IT.
 *
 * The same component on all three surfaces — the console (an admin or the
 * accounts officer, for anybody), the teacher portal and the staff portal
 * (for themselves). It is one component because it is one document: a
 * payslip is what somebody takes to a bank, and the office's copy and the
 * person's copy being subtly different is the kind of thing that costs
 * somebody a loan.
 *
 * PRINT goes through the body portal, not `window.print()` on the page. Every
 * print stylesheet here hides every direct child of `<body>` and shows one;
 * a sheet nested inside the app tree is hidden with its ancestors and the job
 * prints blank pages.
 *
 * DOWNLOAD writes the same HTML as a whole document. Deliberately not a PDF
 * generated in the browser: every print dialog on every platform already
 * offers "Save as PDF", it is the same page, and it does not cost the school
 * a 300 KB library or lose the text layer that makes a payslip searchable.
 */
export function PayslipSheet({ doc, onClose }: { doc: PayslipDoc; onClose?: () => void }) {
  const [printing, setPrinting] = useState(false);
  const html = payslipBody(doc);

  function print() {
    setPrinting(true);
    const fire = (attempt: number) => {
      if (!document.getElementById('payslip-print')) {
        if (attempt < 20) requestAnimationFrame(() => fire(attempt + 1));
        return;
      }
      document.body.classList.add('payslip-printing');
      const done = () => { document.body.classList.remove('payslip-printing'); setPrinting(false); };
      window.addEventListener('afterprint', done, { once: true });
      window.print();
      // Safari never fires `afterprint` from a dialog the user cancels.
      setTimeout(done, 1500);
    };
    fire(0);
  }

  function download() {
    const blob = new Blob([payslipHtml(doc)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payslipFileName(doc, 'html');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button" className="sk-btn sk-press" data-variant="primary"
          onClick={print} disabled={printing} data-testid="payslip-print"
        >
          {printing ? 'Opening…' : 'Print or save as PDF'}
        </button>
        <button type="button" className="sk-btn" onClick={download} data-testid="payslip-download">
          Download
        </button>
        {onClose ? <button type="button" className="sk-btn" onClick={onClose}>Close</button> : null}
      </div>

      <style>{PAYSLIP_CSS}</style>
      {/* The preview a person checks before printing — the same markup that
          goes to the printer, so what they see is what comes out. */}
      <div data-testid="payslip-preview" dangerouslySetInnerHTML={{ __html: html }} />

      <BodyPrintPortal id="payslip-print">
        <style>{PAYSLIP_CSS}</style>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </BodyPrintPortal>
    </div>
  );
}
