import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { BulkCertificateResult } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import CertificateDeskPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

const RESULT: BulkCertificateResult = {
  issued: [
    {
      studentId: 's1', name: 'Aarav Sharma', serial: 'BC/2026/0101', issuedAt: '2026-09-03T05:00:00Z',
      snapshot: {
        kind: 'CERTIFICATE', type: 'BONAFIDE',
        school: { name: 'Rajmata', logoUrl: null, addressLine: null, phone: null, email: null },
        student: {
          id: 's1', name: 'Aarav Sharma', admissionNo: 'RPS-0710', rollNo: '3', classLabel: 'VII-B',
          dob: null, guardianName: null, gender: null, onRollSince: '2021-04-01',
          fatherName: null, motherName: null, nationality: null, category: null,
          firstAdmissionDate: null, firstAdmissionClass: null, previousSchool: null, penId: null,
        },
        fields: { conduct: 'good', classLabel: 'VII-B', purpose: 'scholarship application' },
        duesMinor: 0, duesOverride: false,
      },
    },
  ],
  skipped: [{ studentId: 's2', name: 'Meera Rathore', reason: 'fees outstanding' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('bulk certificates — one class, one run', () => {
  it('posts the real bulk endpoint and reads back every serial and every skip, with its reason', async () => {
    const api = mockApi({
      get: vi.fn().mockImplementation((path: string) =>
        path.startsWith('/manage/press/classes')
          ? Promise.resolve([{ id: 'c1', label: 'VII-B', studentCount: 22 }])
          : Promise.resolve([])),
      post: vi.fn().mockResolvedValue(RESULT),
    });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<CertificateDeskPage />);
    fireEvent.click(screen.getByRole('button', { name: /Whole class at once/ }));

    // Bonafide is the default bulk type — purpose rides the whole run.
    // Wait for the class OPTION itself: setting a select before its options
    // exist silently leaves the value empty and the run button disabled.
    await waitFor(() => expect(screen.getByText(/VII-B · 22 students/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/Purpose/), { target: { value: 'scholarship application' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue for the whole class' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/press/certificates/bulk', {
      type: 'BONAFIDE', classSectionId: 'c1', purpose: 'scholarship application',
    }));
    expect(await screen.findByText('BC/2026/0101')).toBeInTheDocument();
    expect(screen.getByText('fees outstanding')).toBeInTheDocument();
    // View-then-print: the run's button opens the Print Room, it never fires
    // a dialog on sheets nobody has seen (portal-race.test.tsx).
    expect(screen.getByRole('button', { name: /View & print all 1/ })).toBeInTheDocument();
  });
});
