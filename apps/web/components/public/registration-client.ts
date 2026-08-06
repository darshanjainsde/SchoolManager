'use client';

/**
 * Browser-side event registration, mirroring `enquiry-client` deliberately:
 * the browser is already on the school's host, and forwarding that host is what
 * lets the API resolve the tenant.
 */
function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

/** The tenant is resolved from the host; Vercel's ingress rewrites the standard one. */
function hostHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Forwarded-Host': window.location.host,
    'X-Skoolos-Host': window.location.host,
  };
}

export type SessionProbe = { signedIn: false } | { signedIn: true; token: string; name: string };

/**
 * "Is whoever is reading this already signed in?"
 *
 * The refresh token is an HttpOnly cookie, so the only way to know is to ask
 * the API to spend it — the same trick `useSessionProbe` plays for the portal
 * shells. This copy exists rather than reusing that hook because it must run on
 * the PUBLIC site, which deliberately carries no auth store and no ApiClient;
 * dragging those onto a page every visitor loads is a worse trade than twenty
 * lines of fetch.
 *
 * It runs only when somebody opens the join sheet, so an anonymous visitor who
 * never registers never pays for it.
 *
 * A TEACHER or STAFF login answers `signedIn: false` here on purpose: they are
 * authenticated but have no pupil record, and `/me/profile` refuses them. The
 * guest form is the right door for them.
 */
export async function probeSignedIn(): Promise<SessionProbe> {
  const base = apiBase();
  const res = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: hostHeaders(),
    credentials: 'include',
    body: '{}',
  });
  if (!res.ok) return { signedIn: false };
  const { accessToken } = (await res.json()) as { accessToken?: string };
  if (!accessToken) return { signedIn: false };

  const me = await fetch(`${base}/me/profile`, {
    headers: { ...hostHeaders(), Authorization: `Bearer ${accessToken}` },
  });
  if (!me.ok) return { signedIn: false };
  const profile = (await me.json()) as { firstName?: string; lastName?: string };
  const name = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();
  return name ? { signedIn: true, token: accessToken, name } : { signedIn: false };
}

/** The signed-in door: the place is filed against the pupil, not a guest. */
export async function submitRegistrationAsStudent(
  eventId: string,
  quantity: number,
  token: string,
): Promise<RegistrationResult> {
  try {
    const res = await fetch(`${apiBase()}/me/events/${eventId}/register`, {
      method: 'POST',
      headers: { ...hostHeaders(), Authorization: `Bearer ${token}` },
      credentials: 'include',
      body: JSON.stringify({ quantity }),
    });
    if (res.status === 429) return { ok: false, reason: 'rate' };
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

export type RegistrationResult =
  | { ok: true; status: 'CONFIRMED' | 'WAITLISTED' | 'HELD'; waitlistPos: number | null }
  | { ok: false; reason: 'rate' | 'closed' | 'error' };

export async function submitRegistration(
  eventId: string,
  fields: { guestName: string; guestEmail: string; guestPhone: string; quantity: number },
): Promise<RegistrationResult> {
  try {
    const res = await fetch(`${apiBase()}/public/events/${eventId}/register`, {
      method: 'POST',
      headers: hostHeaders(),
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
