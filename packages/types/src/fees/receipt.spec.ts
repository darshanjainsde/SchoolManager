import { receiptBody, receiptHtml, receiptRupees } from './receipt';

const R = {
  number: 'RCP/2026/00311', issuedAt: '2026-07-12T10:00:00Z', amountMinor: 1880000, method: 'UPI', providerRef: '4418<x>',
  paidOn: '2026-07-12', verifiedAt: '2026-07-12T10:00:00Z', termName: 'Term 1', invoiceNumber: 'INV/2026/0042',
  student: { name: 'Ved & Co', admissionNo: 'RAF-00218', className: 'Nursery-A' }, school: { name: 'Saraswati Public School' },
};

describe('the receipt document', () => {
  it('carries the number, the amount in Indian grouping, the term and the payer — escaped', () => {
    const b = receiptBody(R);
    expect(b).toContain('RCP/2026/00311');
    expect(b).toContain('₹18,800');
    expect(b).toContain('Term 1 · INV/2026/0042');
    expect(b).toContain('Ved &amp; Co · Nursery-A');
    expect(b).toContain('ref 4418&lt;x&gt;');
  });
  it('the full document is a page with its own styles', () => {
    const h = receiptHtml(R);
    expect(h.startsWith('<!doctype html>')).toBe(true);
    expect(h).toContain('.rcpt-stamp');
  });
  it('groups a crore the Indian way', () => {
    expect(receiptRupees(2257760000)).toBe('₹2,25,77,600');
  });
});
