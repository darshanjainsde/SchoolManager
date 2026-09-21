import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OtpLogin, type OtpApi } from './OtpLogin';

const REQ = { challengeId: '11111111-1111-1111-1111-111111111111', phoneMasked: '+91 98••• •3210', sentVia: ['whatsapp'], expiresIn: 600 };
const TOKENS = { choose: false, accessToken: 'a', refreshToken: 'r' };
const ravi = { userId: 'u-ravi', kind: 'FAMILY', role: 'STUDENT', label: 'Ravi Sharma', sub: 'Class 5-B', schoolName: 'Raffles', host: 'raffles.sckools.com' };
const priya = { userId: 'u-priya', kind: 'TEACHER', role: 'TEACHER', label: 'Priya Nair', sub: 'Teacher', schoolName: 'Raffles', host: 'raffles.sckools.com' };

function stub(verify: unknown = TOKENS) {
  const post = vi.fn(async (path: string) => (path === '/auth/otp/request' ? REQ : path === '/auth/otp/verify' ? verify : TOKENS));
  return { post } as unknown as OtpApi & { post: typeof post };
}

describe('OtpLogin — the phone door', () => {
  it('number → code → tokens, with the masked number and channel named', async () => {
    const api = stub(); const onTokens = vi.fn().mockResolvedValue(undefined);
    render(<OtpLogin api={api} onTokens={onTokens} />);
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '98765 43210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    const codeStep = await screen.findByTestId('otp-code');
    expect(api.post).toHaveBeenCalledWith('/auth/otp/request', { phone: '98765 43210' });
    expect(within(codeStep).getByText(/Sent to \+91 98••• •3210 on WhatsApp/)).toBeInTheDocument();
    const input = screen.getByLabelText('The 6-digit code');
    fireEvent.change(input, { target: { value: '48a29b11' } });
    expect(input).toHaveValue('482911');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/otp/verify', { challengeId: REQ.challengeId, code: '482911' }));
    await waitFor(() => expect(onTokens).toHaveBeenCalledWith(TOKENS));
  });

  it('two profiles on the number → a chooser; the pick opens that profile', async () => {
    const api = stub({ choose: true, ticket: 't-1', profiles: [ravi, priya] }); const onTokens = vi.fn().mockResolvedValue(undefined);
    render(<OtpLogin api={api} onTokens={onTokens} />);
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('The 6-digit code'), { target: { value: '482911' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const chooser = await screen.findByTestId('otp-choose');
    expect(within(chooser).getAllByRole('listitem').map((b) => b.textContent)).toEqual(['RSRavi SharmaClass 5-B · Raffles', 'PNPriya NairTeacher · Raffles']);
    fireEvent.click(within(chooser).getByText('Priya Nair'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/otp/choose', { ticket: 't-1', userId: 'u-priya' }));
    await waitFor(() => expect(onTokens).toHaveBeenCalled());
  });

  it('a wrong code shows the server\'s words and keeps the step; "send again" waits a minute', async () => {
    const post = vi.fn(async (path: string) => { if (path === '/auth/otp/request') return REQ; throw new Error('That code is not right. 4 tries left.'); });
    const api = { post } as unknown as OtpApi;
    render(<OtpLogin api={api} onTokens={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('The 6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right. 4 tries left.');
    expect(screen.getByTestId('otp-code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send again in \d+s/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Change number' }));
    expect(screen.getByTestId('otp-phone')).toBeInTheDocument();
  });
});
