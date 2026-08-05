'use client';

/**
 * Browser-side event registration, mirroring `enquiry-client` deliberately:
 * the browser is already on the school's host, and forwarding that host is what
 * lets the API resolve the tenant.
 */
export type RegistrationResult =
  | { ok: true; status: 'CONFIRMED' | 'WAITLISTED' | 'HELD'; waitlistPos: number | null }
  | { ok: false; reason: 'rate' | 'closed' | 'error' };

export async function submitRegistration(
  eventId: string,
  fields: { guestName: string; guestEmail: string; guestPhone: string; quantity: number },
): Promise<RegistrationResult> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${base}/public/events/${eventId}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Vercel's ingress OVERWRITES X-Forwarded-Host with the deployment
        // host, so the API prefers the app-controlled X-Skoolos-Host.
        'X-Forwarded-Host': window.location.host,
        'X-Skoolos-Host': window.location.host,
      },
      body: JSON.stringify({
        guestName: fields.guestName,
        guestEmail: fields.guestEmail,
        ...(fields.guestPhone ? { guestPhone: fields.guestPhone } : {}),
        quantity: fields.quantity,
      }),
    });
    if (res.status === 429) return { ok: false, reason: 'rate' };
    // 400 is the API saying the door is shut on this event — registration
    // closed, not approved, or hosted by another school. Distinct from a
    // failure, because the page should say something different about it.
    if (res.status === 400) return { ok: false, reason: 'closed' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const body = (await res.json()) as { status: string; waitlistPos: number | null };
    return {
      ok: true,
      status: body.status as 'CONFIRMED' | 'WAITLISTED' | 'HELD',
      waitlistPos: body.waitlistPos ?? null,
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
