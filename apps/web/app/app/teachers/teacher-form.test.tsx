import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeacherForm, { isMobile, serverFieldErrors, toRecordBody, toRecordInput, validateRecord, type IdentityCheck } from './teacher-form';
import { ApiError } from '@/lib/api';

vi.mock('@/components/use-email-check', () => ({ EmailHint: () => null }));

const props = { title: 'Add teacher', onSave: vi.fn(), isSaving: false, onCancel: vi.fn(), onPhotoUpload: vi.fn(), isUploadingPhoto: false, uploadedPhotoUrl: null };
const nobody: IdentityCheck = { teacherHere: null, activeElsewhere: null, familyHere: [], phoneValid: true };

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('First name'), 'Rishika');
  await user.type(screen.getByLabelText('Email'), 'rishika@school.in');
  await user.type(screen.getByLabelText('Mobile'), '63780 19877');
}

describe('the teacher record form', () => {
  it('opens on name, email and mobile; the four record sections are folded', () => {
    render(<TeacherForm {...props} />);
    for (const l of ['First name', 'Last name', 'Email', 'Mobile', 'Gender', 'Date of birth']) expect(screen.getByLabelText(l)).toBeInTheDocument();
    for (const s of ['Contact', 'Employment', 'Qualifications', 'Safety & compliance']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${s}`) })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByLabelText('WhatsApp number')).not.toBeInTheDocument();
    expect(screen.getByText('First name, email and mobile to start')).toBeInTheDocument();
  });

  it('marks exactly first name, email and mobile as required — a last name is optional', () => {
    render(<TeacherForm {...props} />);
    const required = screen.getAllByRole('textbox').filter((el) => el.getAttribute('aria-required') === 'true').map((el) => el.id);
    expect(required).toEqual(['tf-first', 'tf-email', 'tf-phone']);
    expect(screen.getByText(/leave blank if they use one name/)).toBeInTheDocument();
  });

  it('Save is never greyed out: pressed empty, it marks the three fields red, names them, and focuses the first', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<TeacherForm {...props} onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(onSave).not.toHaveBeenCalled();
    for (const l of ['First name', 'Email', 'Mobile']) expect(screen.getByLabelText(l)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Last name')).not.toHaveAttribute('aria-invalid');
    const summary = screen.getAllByRole('alert').find((el) => el.className.includes('sk-tf-sum'))!;
    expect(summary).toHaveTextContent('3 fields need attention');
    expect(screen.getByLabelText('First name')).toHaveFocus();
    expect(screen.getByText('Enter their email. It becomes their login.')).toBeInTheDocument();
    // The reason is tied to the field for a screen reader.
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', 'tf-email-err');
  });

  it('an error clears the moment its field is fixed, without pressing Save again', async () => {
    const user = userEvent.setup({ delay: null });
    render(<TeacherForm {...props} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(screen.getByLabelText('First name'), 'R');
    expect(screen.getByLabelText('First name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('2 fields need attention:')).toBeInTheDocument();
  });

  it('the summary’s names jump to their field', async () => {
    const user = userEvent.setup({ delay: null });
    render(<TeacherForm {...props} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: /^Mobile/ }));
    expect(screen.getByLabelText('Mobile')).toHaveFocus();
  });

  it('a bad WhatsApp number inside the folded Contact section opens it and is focused', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<TeacherForm {...props} onSave={onSave} initial={{ firstName: 'A', email: 'a@school.in', phone: '9876543210', whatsappPhone: '12345' }} />);
    expect(screen.queryByLabelText('WhatsApp number')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('WhatsApp number')).toHaveFocus();
    expect(screen.getByLabelText('WhatsApp number')).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves with only the three, sending the email and an empty last name', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<TeacherForm {...props} onSave={onSave} />);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const body = toRecordBody(onSave.mock.calls[0][0]);
    expect(body).toMatchObject({ firstName: 'Rishika', lastName: '', email: 'rishika@school.in', phone: '63780 19877', designation: '', dob: '', whatsappOptIn: false });
    expect(body).not.toHaveProperty('experienceYears');
  });

  it('a server refusal lands on its field, and editing that field clears it', async () => {
    const user = userEvent.setup({ delay: null });
    const err = new ApiError(409, 'x', { code: 'ALREADY_TEACHER_HERE', message: 'Meera Rao is already a teacher here with this mobile number.', field: 'phone' });
    const { rerender } = render(<TeacherForm {...props} />);
    rerender(<TeacherForm {...props} serverError={err} />);
    expect(screen.getByLabelText('Mobile')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Meera Rao is already a teacher here with this mobile number.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Mobile')).toHaveFocus());
    await user.type(screen.getByLabelText('Mobile'), '1');
    expect(screen.getByLabelText('Mobile')).not.toHaveAttribute('aria-invalid');
  });

  describe('who is this? — the live check', () => {
    it('stays quiet until a real email or mobile is typed, then asks once per value', async () => {
      const user = userEvent.setup({ delay: null });
      const checkIdentity = vi.fn().mockResolvedValue(nobody);
      render(<TeacherForm {...props} checkIdentity={checkIdentity} />);
      expect(screen.getByText(/Type their email and mobile/)).toBeInTheDocument();
      await user.type(screen.getByLabelText('Mobile'), '98765');
      await new Promise((r) => setTimeout(r, 500));
      expect(checkIdentity).not.toHaveBeenCalled();
      await user.type(screen.getByLabelText('Mobile'), '43210');
      await waitFor(() => expect(checkIdentity).toHaveBeenCalledWith({ phone: '9876543210' }));
      expect(checkIdentity).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Not a teacher here yet.')).toBeInTheDocument();
      expect(screen.getByText('Free to join.')).toBeInTheDocument();
    });

    it('a teacher already here blocks Save on the field that matched, before the server is asked', async () => {
      const user = userEvent.setup({ delay: null });
      const onSave = vi.fn();
      const checkIdentity = vi.fn().mockResolvedValue({ ...nobody, teacherHere: { id: 't1', name: 'Meera Rao', field: 'email', left: false } });
      render(<TeacherForm {...props} onSave={onSave} checkIdentity={checkIdentity} />);
      await fillRequired(user);
      expect(await screen.findByText('Meera Rao is already a teacher here with this email.')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Email')).toHaveFocus();
    });

    it('active at another school: said without naming it, and Save is blocked', async () => {
      const user = userEvent.setup({ delay: null });
      const onSave = vi.fn();
      render(<TeacherForm {...props} onSave={onSave} checkIdentity={vi.fn().mockResolvedValue({ ...nobody, activeElsewhere: 'phone' })} />);
      await fillRequired(user);
      expect(await screen.findByText('Active at another school.')).toBeInTheDocument();
      expect(screen.getByLabelText('Mobile')).toHaveAttribute('aria-invalid', 'true');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('also a parent here is said, and never blocks', async () => {
      const user = userEvent.setup({ delay: null });
      const onSave = vi.fn();
      render(<TeacherForm {...props} onSave={onSave} checkIdentity={vi.fn().mockResolvedValue({ ...nobody, familyHere: ['Aarav Agarwal (III-B)'] })} />);
      await fillRequired(user);
      const panel = await screen.findByText('Also a parent here.');
      expect(panel.parentElement).toHaveTextContent('Aarav Agarwal (III-B)');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('an edit never reports the record as its own duplicate', async () => {
      const checkIdentity = vi.fn().mockResolvedValue(nobody);
      render(<TeacherForm {...props} title="Edit teacher" checkIdentity={checkIdentity} initial={{ id: 't9', firstName: 'Priya', email: 'p@school.in', phone: '9876543210' }} />);
      await waitFor(() => expect(checkIdentity).toHaveBeenCalledWith({ email: 'p@school.in', phone: '9876543210', excludeId: 't9' }));
    });
  });

  it('the side panel counts what an inspection would still find missing, and never blocks', () => {
    render(<TeacherForm {...props} initial={{ firstName: 'Priya', email: 'p@x.in', phone: '9876543210', designation: 'TGT', policeVerification: 'CLEARED' }} />);
    const panel = screen.getByRole('complementary', { name: 'About this teacher' });
    expect(within(panel).getByText('3 of 9')).toBeInTheDocument();
    expect(within(panel).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
  });

  it('Contact holds the WhatsApp number and the consent that lets them act from it', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<TeacherForm {...props} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /^Contact/ }));
    await user.type(screen.getByLabelText('WhatsApp number'), '98765 43210');
    await user.click(screen.getByRole('checkbox', { name: /agreed to school messages on WhatsApp/ }));
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(toRecordBody(onSave.mock.calls[0][0])).toMatchObject({ whatsappPhone: '98765 43210', whatsappOptIn: true });
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

  it('a stored teacher opens with their record, its dates shown the Indian way', async () => {
    const user = userEvent.setup({ delay: null });
    render(<TeacherForm {...props} title="Edit teacher" initial={{ firstName: 'Priya', lastName: 'Iyer', designation: 'TGT', joinedOn: '2019-06-01T00:00:00.000Z', whatsappPhone: '9876543210', experienceYears: 7 }} />);
    expect(screen.getByLabelText('First name')).toHaveValue('Priya');
    expect(screen.getByText('6 details on file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Employment/ })).toHaveTextContent('Trained Graduate Teacher (TGT) · joined 2019-06-01');
    await user.click(screen.getByRole('button', { name: /^Employment/ }));
    expect(screen.getByLabelText('Date of joining')).toHaveValue('01/06/2019');
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

describe('the checks behind Save', () => {
  it.each(['9876543210', '+91 98765 43210', '098765-43210', '919876543210'])('%p is a mobile', (p) => expect(isMobile(p)).toBe(true));
  it.each(['12345', '5876543210', '98765'])('%p is not', (p) => expect(isMobile(p)).toBe(false));

  it('validateRecord: the three required, a bad email, a bad optional WhatsApp, experience out of range', () => {
    const blank = toRecordInput({});
    expect(Object.keys(validateRecord(blank))).toEqual(['firstName', 'email', 'phone']);
    const e = validateRecord({ ...blank, firstName: 'A', email: 'a@school', phone: '9876543210', whatsappPhone: '123', experienceYears: '61' });
    expect(Object.keys(e)).toEqual(['email', 'whatsappPhone', 'experienceYears']);
  });

  it('serverFieldErrors: a coded refusal goes to its field; DTO sentences go to theirs; the rest to the form', () => {
    expect(serverFieldErrors(new ApiError(409, 'x', { code: 'ALREADY_AT_SCHOOL', message: 'Active elsewhere.', field: 'email' }))).toEqual({ email: 'Active elsewhere.' });
    expect(serverFieldErrors(new ApiError(400, 'x', { message: ['Enter their first name.', 'Enter a 10-digit mobile number.', 'something odd'] }))).toEqual({
      firstName: 'Enter their first name.', phone: 'Enter a 10-digit mobile number.', form: 'something odd',
    });
    expect(serverFieldErrors(new Error('Network down'))).toEqual({ form: 'Network down' });
    expect(serverFieldErrors(null)).toEqual({});
  });
});
