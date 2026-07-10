'use client';

/**
 * Browser-side lead submission for the sckools.com marketing site — same
 * host-header rules as enquiry-client.ts (Vercel overwrites X-Forwarded-Host,
 * the API prefers the app-controlled X-Skoolos-Host).
 */
export type LeadResult = 'ok' | 'rate' | 'error';

export interface LeadFields {
  name?: string;
  phone: string;
  school?: string;
  interest?: string;
  source: string;
}

export async function submitLead(fields: LeadFields): Promise<LeadResult> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${base}/marketing/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': window.location.host,
        'X-Skoolos-Host': window.location.host,
      },
      body: JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([, v]) => v))),
    });
    if (res.status === 429) return 'rate';
    if (!res.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}
