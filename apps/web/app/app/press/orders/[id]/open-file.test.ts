import { describe, it, expect, vi } from 'vitest';
import { reserveTab, sendTabTo, dropTab, type OpenedTab, type OpenWindow } from './open-file';

function fakeTab(): OpenedTab & {
  location: { replace: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
} {
  return { closed: false, opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
}

describe('reserving a tab for a signed link', () => {
  it('never passes noopener, because that flag returns null instead of a tab', () => {
    // This is the whole guard. `noopener` reads like free hardening and is the
    // obvious thing to add back; it silently costs us the handle, and the
    // failure only shows in a real browser — a stubbed open returns a tab
    // either way. So assert the feature string itself.
    const open = vi.fn(() => fakeTab()) as unknown as OpenWindow;
    reserveTab(open);
    const features = (open as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(features ?? '').not.toContain('noopener');
  });

  it('opens a blank tab rather than the real url, which is not known yet', () => {
    const open = vi.fn(() => fakeTab()) as unknown as OpenWindow;
    reserveTab(open);
    expect(open).toHaveBeenCalledWith('', '_blank');
  });

  it('hands back null when the browser refused, instead of throwing', () => {
    const open = vi.fn(() => null) as unknown as OpenWindow;
    expect(reserveTab(open)).toBeNull();
  });
});

describe('sending the reserved tab to the document', () => {
  const URL = 'https://storage.example/print-orders/abc.pdf?X-Amz-Signature=deadbeef';

  it('navigates the tab it already holds', () => {
    const tab = fakeTab();
    const open = vi.fn() as unknown as OpenWindow;
    sendTabTo(tab, URL, open);
    expect(tab.location.replace).toHaveBeenCalledWith(URL);
    expect(open).not.toHaveBeenCalled();
  });

  it('cuts the new page off from this one before navigating', () => {
    const tab = fakeTab();
    sendTabTo(tab, URL, vi.fn() as unknown as OpenWindow);
    expect(tab.opener).toBeNull();
  });

  it('replaces rather than pushes, so Back does not land on a blank tab', () => {
    const tab = fakeTab() as OpenedTab & { location: Record<string, unknown> };
    sendTabTo(tab, URL, vi.fn() as unknown as OpenWindow);
    expect(tab.location.replace).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBeUndefined();
  });

  it('falls back to a direct open when no tab was reserved', () => {
    const open = vi.fn() as unknown as OpenWindow;
    sendTabTo(null, URL, open);
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer');
  });

  it('falls back when the user closed the tab while the link was being signed', () => {
    const tab = fakeTab();
    tab.closed = true;
    const open = vi.fn() as unknown as OpenWindow;
    sendTabTo(tab, URL, open);
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer');
  });
});

describe('when the link cannot be signed', () => {
  it('closes the reserved tab, so no blank page is left behind', () => {
    const tab = fakeTab();
    dropTab(tab);
    expect(tab.close).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the browser refused to open one', () => {
    expect(() => dropTab(null)).not.toThrow();
  });

  it('does not re-close a tab the user already closed', () => {
    const tab = fakeTab();
    tab.closed = true;
    dropTab(tab);
    expect(tab.close).not.toHaveBeenCalled();
  });
});
