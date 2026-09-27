import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeacherForm, { toRecordBody, toRecordInput } from './teacher-form';

vi.mock('@/components/use-email-check', () => ({ EmailHint: () => null }));

const props = { title: 'Add teacher', onSave: vi.fn(), isSaving: false, onCancel: vi.fn(), onPhotoUpload: vi.fn(), isUploadingPhoto: false, uploadedPhotoUrl: null };

describe('the teacher record form', () => {
  it('opens on the two names and the email; the four record sections are folded', () => {
    render(<TeacherForm {...props} />);
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    for (const s of ['Contact', 'Employment', 'Qualifications', 'Safety & compliance']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${s}`) })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByLabelText('WhatsApp number')).not.toBeInTheDocument();
    expect(screen.getByText('Only the names are needed to start')).toBeInTheDocument();
  });

  it('save needs only the names, and never sends an empty email', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<TeacherForm {...props} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('First name'), 'Rajeshwari');
    await user.type(screen.getByLabelText('Last name'), 'Balasubramanian');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const body = toRecordBody(onSave.mock.calls[0][0]);
    expect(body).toMatchObject({ firstName: 'Rajeshwari', lastName: 'Balasubramanian', whatsappOptIn: false });
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('experienceYears');
  });

  it('Contact holds the WhatsApp number and the consent that lets them act from it', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<TeacherForm {...props} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /^Contact/ }));
    await user.type(screen.getByLabelText('WhatsApp number'), '98765 43210');
    await user.click(screen.getByRole('checkbox', { name: /agreed to school messages on WhatsApp/ }));
    await user.type(screen.getByLabelText('First name'), 'A');
    await user.type(screen.getByLabelText('Last name'), 'B');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(toRecordBody(onSave.mock.calls[0][0])).toMatchObject({ whatsappPhone: '98765 43210', whatsappOptIn: true });
    // The section summary says what is on file once it is folded again.
    await user.click(screen.getByRole('button', { name: /^Contact/ }));
    expect(screen.getByRole('button', { name: /^Contact/ })).toHaveTextContent('WhatsApp 98765 43210');
  });

  it('Employment and Qualifications offer the board’s lists, not free text', async () => {
    const user = userEvent.setup({ delay: null });
    render(<TeacherForm {...props} />);
    await user.click(screen.getByRole('button', { name: /^Employment/ }));
    const post = screen.getByLabelText('Post') as HTMLSelectElement;
    expect([...post.options].map((o) => o.value)).toEqual(expect.arrayContaining(['PRT', 'TGT', 'PGT', 'PRINCIPAL']));
    await user.click(screen.getByRole('button', { name: /^Qualifications/ }));
    const tet = screen.getByLabelText('TET status') as HTMLSelectElement;
    expect([...tet.options].map((o) => o.value)).toEqual(expect.arrayContaining(['CTET', 'STATE_TET', 'NONE', 'NOT_REQUIRED']));
    expect(screen.getByText(/Required to teach classes I–VIII/)).toBeInTheDocument();
  });

  it('a stored teacher opens with their record and a count of what is on file', () => {
    render(<TeacherForm {...props} title="Edit teacher" initial={{ firstName: 'Priya', lastName: 'Iyer', designation: 'TGT', joinedOn: '2019-06-01T00:00:00.000Z', whatsappPhone: '9876543210', experienceYears: 7 }} />);
    expect(screen.getByLabelText('First name')).toHaveValue('Priya');
    expect(screen.getByText('4 details on file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Employment/ })).toHaveTextContent('Trained Graduate Teacher (TGT) · joined 2019-06-01');
  });

  it('experience is sent as a number, dates as YYYY-MM-DD, blanks as empty strings that clear the column', () => {
    const input = toRecordInput({ experienceYears: 7, dob: '1988-03-14T00:00:00.000Z' });
    expect(input.experienceYears).toBe('7');
    expect(input.dob).toBe('1988-03-14');
    const body = toRecordBody({ ...input, firstName: 'A', lastName: 'B', designation: '', email: '' });
    expect(body.experienceYears).toBe(7);
    expect(body.dob).toBe('1988-03-14');
    expect(body.designation).toBe('');
    expect(body).not.toHaveProperty('email');
  });
});
