import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DuesPage from './page';

/**
 * Students and teachers are separate tabs, and the total belongs to whichever
 * tab you are on. A teacher's debt inside a "students owe" figure is the exact
 * thing this split exists to prevent.
 */

// A STABLE object, hoisted. Returning a fresh `{host, token}` on every render
// changes the identity of `useCallback`'s dependency each time, so the loading
// effect re-fires forever and the test OOMs. The real `useApiCtx` holds it in
// state and is stable after mount — the mock has to be too, or it is testing a
// component that does not exist.
const CTX = { host: 'h', token: 't' };
vi.mock('@/lib/session', () => ({ useApiCtx: () => CTX }));

const listDuesMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/lost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lost')>()),
  listDues: listDuesMock,
}));

const STUDENT = {
  memberId: 's1', code: 'S1', firstName: 'Meera', lastName: 'Nair',
  memberType: 'STUDENT', classRef: '6-B', owed: 201, fineCount: 2,
  kinds: ['OVERDUE', 'LOST'],
};
const TEACHER = {
  memberId: 't1', code: 'T1', firstName: 'Sunita', lastName: 'Menon',
  memberType: 'TEACHER', classRef: null, owed: 300, fineCount: 1, kinds: ['OVERDUE'],
};

describe('DuesPage', () => {
  beforeEach(() => {
    listDuesMock.mockReset().mockImplementation((_ctx, params) =>
      Promise.resolve(params?.memberType === 'TEACHER' ? [TEACHER] : [STUDENT]),
    );
  });

  it('asks the API for students by default, and totals only them', async () => {
    render(<DuesPage />);
    await waitFor(() => expect(listDuesMock).toHaveBeenCalled());
    expect(listDuesMock.mock.calls[0][1]).toMatchObject({ memberType: 'STUDENT' });

    expect(await screen.findByText('Meera Nair')).toBeInTheDocument();
    // 201 — the student's debt alone. The teacher's 300 is not in this number.
    // Asserted on the TOTAL specifically (the <strong>), because the same
    // amount legitimately also appears in the member's own row.
    expect(screen.getByText('₹201.00', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/owed by 1 students/)).toBeInTheDocument();
    expect(screen.queryByText('Sunita Menon')).not.toBeInTheDocument();
  });

  it('switches to teachers as a separate list, never merged', async () => {
    render(<DuesPage />);
    await screen.findByText('Meera Nair');

    fireEvent.click(screen.getByRole('tab', { name: 'Teachers' }));

    expect(await screen.findByText('Sunita Menon')).toBeInTheDocument();
    expect(screen.queryByText('Meera Nair')).not.toBeInTheDocument();
    expect(screen.getByText('₹300.00', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/owed by 1 teachers/)).toBeInTheDocument();
  });

  it('shows why each member owes, in plain words', async () => {
    render(<DuesPage />);
    // "Late", not "OVERDUE" — no jargon anywhere in this product.
    expect(await screen.findByText(/Late, Lost book/)).toBeInTheDocument();
  });
});
