import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLATFORM_HOST } from '@/lib/hosts';

/**
 * sckools.com/workplace — the page LinkedIn's "workplace policy" field links
 * to. It belongs to Sckools, so a school's own address must 404 it (same rule
 * as /privacy and /terms), and the short policy stays within LinkedIn's
 * 300-character box.
 */
const host = vi.fn();
vi.mock('@/lib/request', () => ({ getRequestHost: () => host() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import WorkplacePage, { metadata } from './page';

beforeEach(() => { vi.clearAllMocks(); });

describe('/workplace', () => {
  it('renders on the Sckools site and says the team is hybrid', async () => {
    host.mockResolvedValue(PLATFORM_HOST);
    const html = renderToStaticMarkup(await WorkplacePage());
    expect(html).toContain('How we work');
    expect(html).toContain('hybrid team');
    expect(html).toContain('mailto:admin@sckools.com');
  });

  it('is not served on a school’s address', async () => {
    host.mockResolvedValue('raffles.sckools.com');
    await expect(WorkplacePage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('points search engines at sckools.com/workplace', () => {
    expect(metadata.alternates?.canonical).toBe('https://sckools.com/workplace');
  });
});
