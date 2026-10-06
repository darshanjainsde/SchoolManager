'use client';
import type { PublicSource } from '@skoolos/types';

/**
 * Browser-side enquiry submission shared by the main enquiry form and the
 * course flip-cards. The browser is already on the school's host; forwarding
 * it lets the API resolve the tenant (it strips the port).
 */
export type EnquiryResult = 'ok' | 'rate' | 'error';

export async function submitEnquiry(fields: {
  parentName: string;
  phone: string;
  email?: string;
  gradeInterest?: string;
  message?: string;
  /** Which public door — the course card says so; the contact form leaves it to default to WEBSITE. */
  source?: PublicSource;
}): Promise<EnquiryResult> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const send = (body: Record<string, unknown>) =>
    fetch(`${base}/public/enquiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Send both: Vercel's ingress OVERWRITES X-Forwarded-Host with the
        // deployment host, which broke every prod submission (404 tenant).
        // The API prefers the app-controlled X-Skoolos-Host.
        'X-Forwarded-Host': window.location.host,
        'X-Skoolos-Host': window.location.host,
      },
      body: JSON.stringify(body),
    });
  try {
    const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
    let res = await send(body);
    // The web and the API deploy separately. An API from before `source` rejects
    // the unknown key with a 400 (forbidNonWhitelisted); a parent's enquiry must
    // not be lost to that, so send it once more without the key.
    if (res.status === 400 && 'source' in body) {
      const { source: _source, ...rest } = body;
      res = await send(rest);
    }
    if (res.status === 429) return 'rate';
    if (!res.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}
