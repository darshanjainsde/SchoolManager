'use client';

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
}): Promise<EnquiryResult> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${base}/public/enquiry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Send both: Vercel's ingress OVERWRITES X-Forwarded-Host with the
        // deployment host, which broke every prod submission (404 tenant).
        // The API prefers the app-controlled X-Skoolos-Host.
        'X-Forwarded-Host': window.location.host,
        'X-Skoolos-Host': window.location.host,
      },
      body: JSON.stringify(
        Object.fromEntries(Object.entries(fields).filter(([, v]) => v)),
      ),
    });
    if (res.status === 429) return 'rate';
    if (!res.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}
