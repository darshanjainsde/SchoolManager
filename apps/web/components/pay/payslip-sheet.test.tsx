import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PayslipDoc } from '@skoolos/types';
import { PayslipSheet } from './payslip-sheet';

const DOC: PayslipDoc = {
  id: 'slip-1', periodLabel: 'September 2026', periodYear: 2026, periodMonth: 9,
  person: { name: 'Asha Rao', designation: 'Teacher', kind: 'TEACHER', pan: 'ABCDE1234F', uan: null, bankAccountLast4: '4821', joinedOn: null },
  lines: [
    { key: 'basic', name: 'Basic', kind: 'EARNING', amountMinor: 2_402_400 },
    { key: 'pf', name: 'Provident fund', kind: 'DEDUCTION', amountMinor: 180_000 },
  ],
  daysInMonth: 30, daysPaid: 30, lopHalfDays: 0,
  grossMinor: 2_402_400, deductionMinor: 180_000, netMinor: 2_222_400, employerCostMinor: 0,
  incomeTaxMinor: 0, taxRegime: 'NEW', ytdGrossMinor: 2_402_400, ytdTaxMinor: 0,
  paidOn: null, school: { name: 'Raffles Primary School' }, rulesAsAt: null, packVersion: null,
};

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
  // jsdom has no object URLs; the download path needs both.
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:x') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); document.body.className = ''; });

describe('a payslip a person can keep', () => {
  it('shows the payslip itself, not a summary of it', async () => {
    render(<PayslipSheet doc={DOC} />);
    const preview = await screen.findByTestId('payslip-preview');
    expect(preview.textContent).toContain('Raffles Primary School');
    expect(preview.textContent).toContain('Asha Rao');
    expect(preview.textContent).toContain('September 2026');
  });

  it('prints through the body portal, not the page', async () => {
    // Every print stylesheet here hides all of body's direct children and
    // shows one. A sheet nested in the app tree prints blank pages.
    render(<PayslipSheet doc={DOC} />);
    await userEvent.click(screen.getByTestId('payslip-print'));
    const portal = document.getElementById('payslip-print');
    expect(portal, 'the print sheet must be a direct child of <body>').not.toBeNull();
    expect(portal!.parentElement).toBe(document.body);
    expect(portal!.textContent).toContain('Asha Rao');
  });

  it('flags the body only for the length of the print', async () => {
    render(<PayslipSheet doc={DOC} />);
    await userEvent.click(screen.getByTestId('payslip-print'));
    expect(window.print).toHaveBeenCalled();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('payslip-printing')).toBe(false);
  });

  it('downloads the whole document under a name a person can find', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<PayslipSheet doc={DOC} />);
    await userEvent.click(screen.getByTestId('payslip-download'));
    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toMatch(/text\/html/);
  });

  it('offers Close only when there is something to close', () => {
    const { rerender } = render(<PayslipSheet doc={DOC} />);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    rerender(<PayslipSheet doc={DOC} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
