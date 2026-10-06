import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { AddEnquiryDrawer } from './add-enquiry';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('Add enquiry — a family who walked in or rang', () => {
  it('posts to the desk with its source, the child and the WhatsApp tick, then hands back the new lead', async () => {
    const api = mockApi({ post: vi.fn().mockResolvedValue({ id: 'new-1' }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    const onClose = vi.fn();
    const onSaved = vi.fn();

    renderWithProviders(<AddEnquiryDrawer onClose={onClose} onSaved={onSaved} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Phone call' }));
    fireEvent.change(screen.getByLabelText(/Parent/), { target: { value: ' Meera Purohit ' } });
    fireEvent.change(screen.getByLabelText(/Child/), { target: { value: 'Aarav' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/site/enquiries', {
        parentName: 'Meera Purohit', phone: '98290 11223', source: 'PHONE', whatsappOk: true, childName: 'Aarav',
      }),
    );
    expect(onSaved).toHaveBeenCalledWith('new-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('starts as a walk-in, and cannot be saved without a name and a number', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi());
    renderWithProviders(<AddEnquiryDrawer onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Walked in' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Save enquiry' })).toBeDisabled();
  });

  /** The API 400s an optional field sent as '' (IsOptional skips only null/undefined). */
  it('leaves a blank email, child, class and note OUT of the body — never sends an empty string', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'n2' });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi({ post }));

    renderWithProviders(<AddEnquiryDrawer onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Parent/), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText(/Child/), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(/Class interested/), { target: { value: '  ' } });
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('childName');
    expect(body).not.toHaveProperty('gradeInterest');
    expect(body).not.toHaveProperty('message');
    expect(Object.values(body)).not.toContain('');
  });

  it.each([
    [400, 'email must be an email'],
    [409, 'This number is already on the desk as Meera Purohit.'],
  ])('a %i is shown inside the drawer; the drawer stays open and nothing typed is lost', async (status, message) => {
    const api = mockApi({ post: vi.fn().mockRejectedValue(new ApiError(status, message, null)) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    const onClose = vi.fn();
    const onSaved = vi.fn();

    renderWithProviders(<AddEnquiryDrawer onClose={onClose} onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText(/Parent/), { target: { value: 'Meera Purohit' } });
    fireEvent.change(screen.getByLabelText(/Child/), { target: { value: 'Aarav' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Came with her husband' } });
    fireEvent.click(screen.getByRole('button', { name: 'Phone call' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Parent/)).toHaveValue('Meera Purohit');
    expect(screen.getByLabelText(/Child/)).toHaveValue('Aarav');
    expect(screen.getByLabelText('Phone number')).toHaveValue('98290 11223');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Came with her husband');
    expect(screen.getByRole('button', { name: 'Phone call' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox')).toBeChecked();
    // And the person can fix it and try again.
    expect(screen.getByRole('button', { name: 'Save enquiry' })).toBeEnabled();
  });

  it('while the request is in flight the button is off, so a double click cannot make two leads', async () => {
    const api = mockApi({ post: vi.fn().mockReturnValue(new Promise(() => {})) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<AddEnquiryDrawer onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Parent/), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    const save = screen.getByRole('button', { name: 'Save enquiry' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('a phone with no digit in it cannot be saved', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi());
    renderWithProviders(<AddEnquiryDrawer onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Parent/), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: 'call me' } });
    expect(screen.getByRole('button', { name: 'Save enquiry' })).toBeDisabled();
  });
});
