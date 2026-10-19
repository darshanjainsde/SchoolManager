import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { ConfirmHost } from '../ConfirmSheet';
import { ThreadSafety } from '../ThreadSafety';
import { PrivacyGroup, LEGAL } from '../AccountSafety';
import { ThemeProvider } from '@/theme/theme-context';
import { api, ApiError } from '@/lib/api';

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  return { api: { request: jest.fn() }, ApiError };
});

const mount = (ui: React.ReactElement) => render(<ThemeProvider>{ui}<ConfirmHost /></ThemeProvider>);
const flush = () => act(async () => {});

describe('report and block a conversation (Play UGC policy, 19 Oct 2026)', () => {
  beforeEach(() => (api.request as jest.Mock).mockReset());

  it('report asks why, then sends the reason to the school', async () => {
    (api.request as jest.Mock).mockResolvedValue({ ok: true });
    mount(<ThreadSafety report={(reason) => api.request(`/me/messages/t1/report`, { method: 'POST', body: { reason } })} block={(blocked) => api.request(`/me/messages/t1/block`, { method: 'POST', body: { blocked } }) as Promise<{ blocked: boolean }>} blockedByMe={false} blockedByOther={false} otherName="Rekha Sinha" onBlockedChange={jest.fn()} />);
    fireEvent.press(screen.getByTestId('thread-report'));
    fireEvent.press(screen.getByText('Rude or abusive'));
    await flush();
    expect(api.request).toHaveBeenCalledWith('/me/messages/t1/report', { method: 'POST', body: { reason: 'Rude or abusive' } });
    expect(screen.getByTestId('thread-safety-note').props.children).toMatch(/Reported/);
  });

  it('block asks first, then blocks; unblock needs no question', async () => {
    const changed = jest.fn();
    (api.request as jest.Mock).mockResolvedValue({ blocked: true });
    const view = mount(<ThreadSafety report={(reason) => api.request(`/manage/messages/t2/report`, { method: 'POST', body: { reason } })} block={(blocked) => api.request(`/manage/messages/t2/block`, { method: 'POST', body: { blocked } }) as Promise<{ blocked: boolean }>} blockedByMe={false} blockedByOther={false} otherName="Aarav" onBlockedChange={changed} />);
    fireEvent.press(screen.getByTestId('thread-block'));
    expect(screen.getByText('Block Aarav?')).toBeTruthy();
    fireEvent.press(screen.getByTestId('confirm-block-action-0'));
    await flush();
    expect(api.request).toHaveBeenCalledWith('/manage/messages/t2/block', { method: 'POST', body: { blocked: true } });
    expect(changed).toHaveBeenCalledWith(true);

    (api.request as jest.Mock).mockResolvedValue({ blocked: false });
    view.rerender(<ThemeProvider><ThreadSafety report={(reason) => api.request(`/manage/messages/t2/report`, { method: 'POST', body: { reason } })} block={(blocked) => api.request(`/manage/messages/t2/block`, { method: 'POST', body: { blocked } }) as Promise<{ blocked: boolean }>} blockedByMe blockedByOther={false} otherName="Aarav" onBlockedChange={changed} /><ConfirmHost /></ThemeProvider>);
    expect(screen.getByTestId('thread-blocked')).toBeTruthy();
    fireEvent.press(screen.getByTestId('thread-block'));
    await flush();
    expect(api.request).toHaveBeenLastCalledWith('/manage/messages/t2/block', { method: 'POST', body: { blocked: false } });
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it('a failed report says so in plain words', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Server is busy'));
    mount(<ThreadSafety report={(reason) => api.request(`/me/messages/t1/report`, { method: 'POST', body: { reason } })} block={(blocked) => api.request(`/me/messages/t1/block`, { method: 'POST', body: { blocked } }) as Promise<{ blocked: boolean }>} blockedByMe={false} blockedByOther={false} otherName="R" onBlockedChange={jest.fn()} />);
    fireEvent.press(screen.getByTestId('thread-report'));
    fireEvent.press(screen.getByText('Something else'));
    await flush();
    expect(screen.getByTestId('thread-safety-note').props.children).toBe('Server is busy');
  });

  it('the other side blocking shows why nothing can be sent', () => {
    mount(<ThreadSafety report={(reason) => api.request(`/me/messages/t1/report`, { method: 'POST', body: { reason } })} block={(blocked) => api.request(`/me/messages/t1/block`, { method: 'POST', body: { blocked } }) as Promise<{ blocked: boolean }>} blockedByMe={false} blockedByOther otherName="R" onBlockedChange={jest.fn()} />);
    expect(screen.getByTestId('thread-blocked').props.children).toMatch(/is blocked/);
    expect(screen.getByText('Block')).toBeTruthy();
  });
});

describe('privacy and account rows (Play account-deletion + privacy policy)', () => {
  it('privacy, terms and deletion are one tap away, and deletion explains before it opens', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mount(<PrivacyGroup />);
    fireEvent.press(screen.getByTestId('profile-privacy'));
    expect(open).toHaveBeenCalledWith(LEGAL.privacy);
    fireEvent.press(screen.getByTestId('profile-delete-account'));
    expect(open).not.toHaveBeenCalledWith(LEGAL.deleteAccount);
    fireEvent.press(screen.getByText('Request deletion'));
    expect(open).toHaveBeenCalledWith(LEGAL.deleteAccount);
  });
});
