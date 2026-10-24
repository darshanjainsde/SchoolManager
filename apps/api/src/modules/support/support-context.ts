/**
 * What the console can say about itself without asking the admin. Kept small
 * and pure: the point is "Chrome on Windows", not a device fingerprint.
 */
export function browserLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser =
    /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
              : null;
  const os =
    /Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad/.test(ua) ? 'iOS'
          : /Mac OS X/.test(ua) ? 'macOS'
            : /CrOS/.test(ua) ? 'ChromeOS'
              : /Linux/.test(ua) ? 'Linux'
                : null;
  if (!browser && !os) return ua.slice(0, 60);
  return [browser, os].filter(Boolean).join(' on ');
}

/** The name a stored key was uploaded under: `support/<s>/<t>/<uuid>-<name>` → `<name>`. */
export function attachmentName(key: string): string {
  const last = key.split('/').pop() ?? key;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');
}
