import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectSection from './ConnectSection';
import type { PublicSiteData } from '@/lib/public-api';

/**
 * THE PAGE THAT HAD NO DOOR.
 *
 * The registration engine — capacity, waitlist, the admin desk — shipped with
 * every route into it behind an admin login. A school could publish an open day
 * and no parent could sign up for it; the desk was empty because there was no
 * way in. This page is the way in.
 *
 * The rules it has to hold:
 *   - the school's own events and the network's are two NAMED groups, because
 *     "is this us or somebody else" is the first question a parent asks;
 *   - a Join button says how many seats are left beside it, or it is sending
 *     people to a hall that filled up on Tuesday;
 *   - past capacity the answer is a place in the queue, not a closed door;
 *   - a network event we cannot count is not joinable here — it links to the
 *     school that runs it;
 *   - "you're going" survives a reload, or the parent registers twice.
 */

const submitRegistration = vi.fn();
const submitRegistrationAsStudent = vi.fn();
const probeSignedIn = vi.fn();
vi.mock('../registration-client', () => ({
  submitRegistration: (...args: unknown[]) => submitRegistration(...args),
  submitRegistrationAsStudent: (...args: unknown[]) => submitRegistrationAsStudent(...args),
  probeSignedIn: (...args: unknown[]) => probeSignedIn(...args),
}));

type Ev = PublicSiteData['events'][number];

function event(over: Partial<Ev> & { id: string; title: string }): Ev {
  return {
    description: null,
    coverUrl: null,
    startAt: '2026-08-20T04:30:00Z',
    endAt: null,
    venue: 'Main hall',
    scope: 'SCHOOL',
    originSchoolName: null,
    isHost: true,
    ticketTypeId: 't1',
    capacity: 50,
    seatsLeft: 12,
    registrationOpen: true,
    priceMinor: 0,
    currency: 'INR',
    ...over,
  };
}

function renderConnect(events: Ev[]) {
  return render(<ConnectSection events={events} timezone="Asia/Kolkata" schoolName="Raffles Primary" />);
}

beforeEach(() => {
  submitRegistration.mockReset();
  submitRegistrationAsStudent.mockReset();
  probeSignedIn.mockReset();
  submitRegistration.mockResolvedValue({ ok: true, status: 'CONFIRMED', waitlistPos: null });
  submitRegistrationAsStudent.mockResolvedValue({ ok: true, status: 'CONFIRMED', waitlistPos: null });
  // Most visitors to a school's public site are not signed in.
  probeSignedIn.mockResolvedValue({ signedIn: false });
  window.localStorage.clear();
});

describe('the two groups', () => {
  it('names the school’s own events and the network’s separately', () => {
    renderConnect([
      event({ id: 'e1', title: 'Open Day' }),
      event({ id: 'e2', title: 'Inter-school Quiz', scope: 'NETWORK', isHost: false, originSchoolName: 'Bloom Public' }),
    ]);
    expect(screen.getByRole('heading', { name: /at our school/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /across the network/i })).toBeInTheDocument();
  });

  it('does not head a group that has nothing under it', () => {
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    expect(screen.queryByRole('heading', { name: /across the network/i })).not.toBeInTheDocument();
  });

  it('says which school is running a network event', () => {
    renderConnect([
      event({ id: 'e2', title: 'Inter-school Quiz', scope: 'NETWORK', isHost: false, originSchoolName: 'Bloom Public' }),
    ]);
    expect(screen.getByText(/Bloom Public/)).toBeInTheDocument();
  });
});

describe('what the card says about getting in', () => {
  it('puts the seats left beside the button', () => {
    renderConnect([event({ id: 'e1', title: 'Open Day', seatsLeft: 12 })]);
    expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument();
    expect(screen.getByText(/12 seats left/i)).toBeInTheDocument();
  });

  it('offers the queue rather than a closed door once the hall is full', () => {
    renderConnect([event({ id: 'e1', title: 'Open Day', seatsLeft: 0 })]);
    expect(screen.getByRole('button', { name: /waitlist/i })).toBeInTheDocument();
  });

  it('says nothing about seats when the event is uncapped', () => {
    renderConnect([event({ id: 'e1', title: 'Open Day', capacity: null, seatsLeft: null })]);
    expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument();
    expect(screen.queryByText(/seats left/i)).not.toBeInTheDocument();
  });

  it('shows the price of a paid event instead of letting it look free', () => {
    renderConnect([event({ id: 'e1', title: 'Gala Night', priceMinor: 25000, currency: 'INR' })]);
    expect(screen.getByText('₹250')).toBeInTheDocument();
  });

  it('sends a network event to the school that runs it rather than offering a join we cannot count', () => {
    renderConnect([
      event({
        id: 'e2',
        title: 'Inter-school Quiz',
        scope: 'NETWORK',
        isHost: false,
        originSchoolName: 'Bloom Public',
        registrationOpen: false,
        seatsLeft: null,
      }),
    ]);
    expect(screen.queryByRole('button', { name: /join/i })).not.toBeInTheDocument();
  });

  it('renders against an api that has never heard of registrations', () => {
    // web and api are two Vercel projects on one push: for a few minutes the
    // page runs against the older api, and it must still list the events.
    const legacy = { ...event({ id: 'e1', title: 'Open Day' }) };
    delete (legacy as Partial<Ev>).registrationOpen;
    delete (legacy as Partial<Ev>).seatsLeft;
    delete (legacy as Partial<Ev>).ticketTypeId;
    renderConnect([legacy]);
    expect(screen.getByText('Open Day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join/i })).not.toBeInTheDocument();
  });
});

describe('the date block', () => {
  it('shows the day, month and time as separate facts, in the school’s timezone', () => {
    renderConnect([event({ id: 'e1', title: 'Open Day', startAt: '2026-08-20T04:30:00Z' })]);
    const card = screen.getByTestId('event-card-e1');
    expect(within(card).getByText('20')).toBeInTheDocument();
    expect(within(card).getByText('Aug')).toBeInTheDocument();
    expect(within(card).getByText(/10:00 am/)).toBeInTheDocument();
  });
});

describe('joining', () => {
  it('asks a guest for the three things the school needs, and nothing else', async () => {
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(sheet.getByLabelText(/email/i)).toBeInTheDocument();
    expect(sheet.getByLabelText(/phone/i)).toBeInTheDocument();
  });

  it('registers the family and tells them they are going', async () => {
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByLabelText(/your name/i), 'Priya Nair');
    await user.type(sheet.getByLabelText(/email/i), 'priya@example.com');
    await user.click(sheet.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(submitRegistration).toHaveBeenCalled());
    expect(submitRegistration).toHaveBeenCalledWith('e1', {
      guestName: 'Priya Nair',
      guestEmail: 'priya@example.com',
      guestPhone: '',
      quantity: 1,
    });
    expect(await screen.findByText(/you’re going/i)).toBeInTheDocument();
  });

  it('does not promise an email, because registering sends none', async () => {
    // RegistrationsService writes the row and stops — there is no mail on the
    // public registration path (the school works the desk). Saying "we've
    // emailed you the details" was a straight lie to a parent who then waits
    // for a message that never arrives. If confirmation mail is ever added,
    // delete this test in the same commit that sends it.
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByLabelText(/your name/i), 'Priya Nair');
    await user.type(sheet.getByLabelText(/email/i), 'priya@example.com');
    await user.click(sheet.getByRole('button', { name: /confirm/i }));

    const banner = await screen.findByRole('status');
    expect(banner.textContent).not.toMatch(/emailed|we’ll email|we will email/i);
  });

  it('says a place was kept in the queue when the event was already full', async () => {
    submitRegistration.mockResolvedValue({ ok: true, status: 'WAITLISTED', waitlistPos: 4 });
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day', seatsLeft: 0 })]);
    await user.click(screen.getByRole('button', { name: /waitlist/i }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByLabelText(/your name/i), 'Priya Nair');
    await user.type(sheet.getByLabelText(/email/i), 'priya@example.com');
    await user.click(sheet.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/number 4/i)).toBeInTheDocument();
  });

  it('keeps the form open and says so when the registration fails', async () => {
    submitRegistration.mockResolvedValue({ ok: false, reason: 'error' });
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));
    const sheet = within(screen.getByRole('dialog'));
    await user.type(sheet.getByLabelText(/your name/i), 'Priya Nair');
    await user.type(sheet.getByLabelText(/email/i), 'priya@example.com');
    await user.click(sheet.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/you’re going/i)).not.toBeInTheDocument();
  });

  it('remembers across a reload that this family is going, so they do not register twice', () => {
    window.localStorage.setItem('sk-going', JSON.stringify({ e1: 'CONFIRMED' }));
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    expect(screen.getByText(/you’re going/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^join/i })).not.toBeInTheDocument();
  });
});

describe('a family that is already signed in', () => {
  /**
   * One tap, and the school gets a record it recognises.
   *
   * A guest row for a school's own pupil is a worse record than the school
   * could have had: the desk shows a typed name where it could show the child,
   * their class and their admission number. So a signed-in family is never
   * asked to retype what the school already knows.
   */
  const AARAV = { signedIn: true as const, token: 'tok', name: 'Aarav Sharma' };

  it('is not asked for a name and email the school already has', async () => {
    probeSignedIn.mockResolvedValue(AARAV);
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));

    const sheet = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(sheet.queryByLabelText(/your name/i)).not.toBeInTheDocument());
    expect(sheet.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it('is told whose place it is booking, so nobody registers as the wrong person', async () => {
    probeSignedIn.mockResolvedValue(AARAV);
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText(/Aarav Sharma/)).toBeInTheDocument();
  });

  it('books through the signed-in door, so the desk shows the pupil and not a guest', async () => {
    probeSignedIn.mockResolvedValue(AARAV);
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));
    const sheet = within(await screen.findByRole('dialog'));
    await user.click(await sheet.findByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(submitRegistrationAsStudent).toHaveBeenCalledWith('e1', 1, 'tok'));
    expect(submitRegistration).not.toHaveBeenCalled();
    expect(await screen.findByText(/you’re going/i)).toBeInTheDocument();
  });

  it('falls back to the guest form when the session check cannot answer', async () => {
    // A refresh that errors must not cost the family the ability to register.
    probeSignedIn.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup({ delay: null });
    renderConnect([event({ id: 'e1', title: 'Open Day' })]);
    await user.click(screen.getByRole('button', { name: /join/i }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findByLabelText(/your name/i)).toBeInTheDocument();
  });
});

describe('a school with nothing on yet', () => {
  it('draws the empty state instead of shrugging with an emoji', () => {
    const { container } = renderConnect([]);
    expect(screen.getByText(/nothing on the calendar/i)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.textContent).not.toContain('📅');
  });
});
