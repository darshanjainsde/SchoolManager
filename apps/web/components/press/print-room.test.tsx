import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CertificateSnapshot } from '@skoolos/types';
import { PrintRoom } from './print-room';

const school = { name: 'Rajmata', logoUrl: null, addressLine: null, phone: null, email: null };
const cert = (serial: string): CertificateSnapshot => ({
  kind: 'CERTIFICATE', type: 'BONAFIDE', school,
  student: {
    id: 's1', name: 'Aarav Sharma', admissionNo: 'RPS-0710', rollNo: '3', classLabel: 'VII-B',
    dob: null, guardianName: null, gender: null, onRollSince: '2021-04-01',
    fatherName: null, motherName: null, nationality: null, category: null,
    firstAdmissionDate: null, firstAdmissionClass: null, previousSchool: null, penId: null,
  },
  fields: { conduct: 'good', classLabel: 'VII-B', purpose: `purpose-${serial}` },
  duesMinor: 0, duesOverride: false,
});

beforeEach(() => vi.clearAllMocks());

describe('the Print Room', () => {
  it('shows the sheet, flips through the set, and the print source holds the SAME sheets', () => {
    const sheets = [
      { kind: 'CERTIFICATE' as const, snapshot: cert('BC/1'), serial: 'BC/1', issuedAt: '2026-09-03T05:00:00Z' },
      { kind: 'CERTIFICATE' as const, snapshot: cert('BC/2'), serial: 'BC/2', issuedAt: '2026-09-03T05:00:00Z' },
    ];
    render(<PrintRoom sheets={sheets} title="2 certificates" onClose={vi.fn()} />);

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next sheet' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();

    // What prints is what's shown: the portal container carries BOTH sheets.
    const portal = document.getElementById('press-print')!;
    expect(portal.textContent).toContain('purpose-BC/1');
    expect(portal.textContent).toContain('purpose-BC/2');
  });

  it('Escape closes the room', () => {
    const onClose = vi.fn();
    render(<PrintRoom
      sheets={[{ kind: 'CERTIFICATE', snapshot: cert('BC/1'), serial: 'BC/1', issuedAt: '2026-09-03T05:00:00Z' }]}
      title="BC/1" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
