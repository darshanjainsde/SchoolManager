import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DecideTable from './decide-table';
import type { SessionStudentRow } from './types';

const put = vi.fn();
vi.mock('@/lib/use-api', () => ({ useApi: () => ({ put: (...a: unknown[]) => put(...a) }) }));
vi.mock('@/components/use-host', () => ({ useHost: () => 'raffles.test.sckools.com' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rows: SessionStudentRow[] = [
  { studentId: 's1', rollNo: '1', name: 'Aarav Mehta', admissionNo: '1', attendancePct: 94, resultsPct: 81, review: false, joinedSincePlan: false, decision: null, toSectionId: 't6b', leaveStatus: null, leaveReason: null, note: null, defaultDecision: 'PROMOTE', stayToSectionId: 't5b' },
  { studentId: 's2', rollNo: '3', name: 'Dev Sharma', admissionNo: '2', attendancePct: 61, resultsPct: 29, review: true, joinedSincePlan: false, decision: null, toSectionId: 't6b', leaveStatus: null, leaveReason: null, note: null, defaultDecision: 'PROMOTE', stayToSectionId: 't5b' },
];
const targets = [{ id: 't6b', label: '6 B', gradeId: 'g6' }, { id: 't5b', label: '5 B', gradeId: 'g5' }];

function mount(onSaved = vi.fn(), extra: Partial<React.ComponentProps<typeof DecideTable>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DecideTable rows={rows} targets={targets} passMarkPct={33} fromYearName="2025-26" onSaved={onSaved} {...extra} />
    </QueryClientProvider>,
  );
  return onSaved;
}

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ saved: 2, version: 5 });
});

describe('DecideTable', () => {
  it('flags a child below the pass mark, lets Stay in grade pick the same-grade class, and saves every row in one PUT', async () => {
    const user = userEvent.setup({ delay: null });
    const onSaved = mount();
    expect(screen.getByText('Review')).toBeInTheDocument();
    const dev = screen.getByRole('row', { name: 'Dev Sharma' });
    await user.click(within(dev).getByRole('button', { name: 'Stay in grade' }));
    expect(within(dev).getByRole('combobox', { name: 'Dev Sharma goes to' })).toHaveValue('t5b');
    await user.click(screen.getByRole('button', { name: 'Save and next class' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/manage/sessions/plan/decisions', {
        rows: [
          { studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' },
          { studentId: 's2', decision: 'STAY', toSectionId: 't5b' },
        ],
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(5);
  });

  it('Leaving asks for the kind and an optional reason, and sends no class', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    const dev = screen.getByRole('row', { name: 'Dev Sharma' });
    await user.click(within(dev).getByRole('button', { name: 'Leaving' }));
    await user.selectOptions(within(dev).getByRole('combobox', { name: 'Dev Sharma leaving as' }), 'LEFT');
    await user.type(within(dev).getByRole('textbox', { name: 'Reason for Dev Sharma' }), 'Moved city');
    await user.click(screen.getByRole('button', { name: 'Save and next class' }));
    await waitFor(() => expect(put.mock.calls[0][1].rows[1]).toEqual({ studentId: 's2', decision: 'LEAVE', leaveStatus: 'LEFT', leaveReason: 'Moved city' }));
  });

  it('Select all → Promote presses Promote on every row; Pass out shows the alumni batch instead of a class', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(screen.getByRole('button', { name: 'Select all → Promote' }));
    expect(screen.getAllByRole('button', { name: 'Promote', pressed: true })).toHaveLength(2);
    await user.click(within(screen.getByRole('row', { name: 'Aarav Mehta' })).getByRole('button', { name: 'Pass out' }));
    expect(screen.getByText('Alumni · Class of 2025-26')).toBeInTheDocument();
  });

  it('a promoted child with no class blocks Save and says so', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Aarav Mehta goes to' }), '');
    expect(screen.getByRole('button', { name: 'Save and next class' })).toBeDisabled();
    expect(screen.getByText('1 promoted child needs a class.')).toBeInTheDocument();
  });

  it('the filters narrow the list without dropping the hidden rows from the save', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(screen.getByRole('button', { name: /Show: below pass mark/ }));
    expect(screen.queryByRole('row', { name: 'Aarav Mehta' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save and next class' }));
    await waitFor(() => expect(put.mock.calls[0][1].rows).toHaveLength(2));
  });
});
