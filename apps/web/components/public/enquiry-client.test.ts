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

  it('an API from before `source` answers 400 — the enquiry is sent once more without it, and is not lost', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await submitEnquiry({ parentName: 'Meera', phone: '98290 11223', source: 'COURSE_CARD' });
    expect(result).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toHaveProperty('source', 'COURSE_CARD');
    const retried = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(retried).not.toHaveProperty('source');
    expect(retried).toEqual({ parentName: 'Meera', phone: '98290 11223' });
  });

  it('does not retry a 400 when no source was sent', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await submitEnquiry({ parentName: 'Meera', phone: '98290 11223' })).toBe('error');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries only once — a second 400 is an error', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await submitEnquiry({ parentName: 'Meera', phone: '98290 11223', source: 'COURSE_CARD' })).toBe('error');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('sends no source when the contact form does not name one (the API defaults it to WEBSITE)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchSpy);
    await submitEnquiry({ parentName: 'Meera', phone: '98290 11223' });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).not.toHaveProperty('source');
  });
});
