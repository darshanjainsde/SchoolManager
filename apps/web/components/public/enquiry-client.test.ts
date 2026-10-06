import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitEnquiry } from './enquiry-client';

afterEach(() => vi.unstubAllGlobals());

describe('submitEnquiry', () => {
  it('puts the source in the request body, and leaves blank fields out', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await submitEnquiry({
      parentName: 'Course card lead', phone: '98290 11223', gradeInterest: 'Nursery', email: '', source: 'COURSE_CARD',
    });

    expect(result).toBe('ok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/public\/enquiry$/);
    expect(JSON.parse(init.body)).toEqual({
      parentName: 'Course card lead', phone: '98290 11223', gradeInterest: 'Nursery', source: 'COURSE_CARD',
    });
  });

  it('sends no source when the contact form does not name one (the API defaults it to WEBSITE)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchSpy);
    await submitEnquiry({ parentName: 'Meera', phone: '98290 11223' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).not.toHaveProperty('source');
  });
});
