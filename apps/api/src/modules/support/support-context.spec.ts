import { attachmentName, browserLabel } from './support-context';

describe('browserLabel', () => {
  it('names the common pairs', () => {
    expect(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(browserLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15')).toBe('Safari on macOS');
    expect(browserLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge on Windows');
  });
  it('keeps a short slice of anything it cannot read, and null for nothing', () => {
    expect(browserLabel(null)).toBeNull();
    expect(browserLabel('curl/8.4.0')).toBe('curl/8.4.0');
  });
});

describe('attachmentName', () => {
  it('strips the folder and the uuid the store prefixed', () => {
    expect(attachmentName('support/s1/t1/2f3a9b1c-1d2e-4f5a-8b9c-0d1e2f3a4b5c-receipt_error.png')).toBe('receipt_error.png');
    expect(attachmentName('plain.png')).toBe('plain.png');
  });
});
