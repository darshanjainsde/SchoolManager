import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StudentAssignment, StudentAssignmentList } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import PortalAssignmentsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function studentAssignment(overrides: Partial<StudentAssignment> = {}): StudentAssignment {
  return {
    id: 'a1',
    subjectId: 'sub-1',
    subjectName: 'Mathematics',
    title: 'Worksheet 3',
    instructions: 'Complete questions 1-10.',
    dueDate: '2026-08-05',
    attachments: [],
    createdAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(<PortalAssignmentsPage />);
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('PortalAssignmentsPage', () => {
  it('shows a loading state, then the empty state when there is nothing to show', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue({ upcoming: [], past: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    expect(screen.getByText('Loading assignments…')).toBeInTheDocument();
    expect(await screen.findByText('No assignments yet.')).toBeInTheDocument();
  });

  it('surfaces a fetch error verbatim', async () => {
    const api = mockApi({ get: vi.fn().mockRejectedValue(new Error('No student record for this login')) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    expect(await screen.findByText('No student record for this login')).toBeInTheDocument();
  });

  it('renders an item the API places in `upcoming` (a due-today assignment) under Upcoming, not Past', async () => {
    // The upcoming/past split itself is server-side (PortalService.assignments:
    // "today counts as upcoming"). This page trusts whichever bucket the API
    // put a row in — this proves the UI renders that placement faithfully.
    const list: StudentAssignmentList = {
      upcoming: [studentAssignment({ id: 'today-1', title: 'Due today' })],
      past: [studentAssignment({ id: 'old-1', title: 'Overdue one' })],
    };
    const api = mockApi({ get: vi.fn().mockResolvedValue(list) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    const upcomingHeading = await screen.findByRole('heading', { name: 'Upcoming' });
    const pastHeading = screen.getByRole('heading', { name: 'Past' });
    // Both live in the same document; check the due-today title sits after
    // "Upcoming" and before "Past" in document order.
    const dueToday = await screen.findByText('Due today');
    const overdue = screen.getByText('Overdue one');
    expect(upcomingHeading.compareDocumentPosition(dueToday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pastHeading.compareDocumentPosition(overdue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens attachment links in a new tab', async () => {
    const user = userEvent.setup();
    const list: StudentAssignmentList = {
      upcoming: [
        studentAssignment({
          id: 'a1',
          attachments: [{ url: 'https://cdn/worksheet.pdf', name: 'worksheet.pdf', kind: 'pdf' }],
        }),
      ],
      past: [],
    };
    const api = mockApi({ get: vi.fn().mockResolvedValue(list) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByRole('button', { name: /Worksheet 3/ }));

    const link = await screen.findByRole('link', { name: /worksheet\.pdf/ });
    expect(link).toHaveAttribute('href', 'https://cdn/worksheet.pdf');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('marks an assignment seen exactly once when first opened, even if toggled open/closed/open again', async () => {
    const user = userEvent.setup();
    const list: StudentAssignmentList = { upcoming: [studentAssignment({ id: 'a1' })], past: [] };
    const postSpy = vi.fn().mockResolvedValue({ ok: true });
    const api = mockApi({ get: vi.fn().mockResolvedValue(list), post: postSpy });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const toggle = await screen.findByRole('button', { name: /Worksheet 3/ });

    await user.click(toggle); // open — fires seen
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/me/assignments/a1/seen'));
    await user.click(toggle); // close
    await user.click(toggle); // re-open — must not fire again

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('does not mark an assignment seen before it is opened', async () => {
    const list: StudentAssignmentList = { upcoming: [studentAssignment({ id: 'a1' })], past: [] };
    const postSpy = vi.fn().mockResolvedValue({ ok: true });
    const api = mockApi({ get: vi.fn().mockResolvedValue(list), post: postSpy });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: /Worksheet 3/ });

    expect(postSpy).not.toHaveBeenCalled();
  });
});
