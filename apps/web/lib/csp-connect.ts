/**
 * WHERE THE BROWSER MAY OPEN A CONNECTION — the `connect-src` of every page.
 *
 * Every page may talk to our own API. The owner console ALSO has to talk to
 * object storage, because "Upload a backup" and "Upload a pack" send the file
 * from the BROWSER straight to a presigned storage URL (a file this size cannot
 * go through a serverless function). With storage missing from this list the
 * browser refuses the request before it leaves the machine — it shows as a
 * bare "Failed to fetch", never reaches storage, and the API logs show nothing
 * at all, which is why it took the server logs to see that a step was missing.
 *
 * So storage is allowed on the owner console and NOWHERE ELSE: a school site, a
 * parent's portal or a teacher's console has no reason to send data to it, and
 * every origin added here is somewhere a script injected into a page could send
 * what it reads. The origins are named, never a wildcard, for the same reason —
 * `*.supabase.co` would include anyone's project.
 */
const API = ['https://api.sckools.com', 'https://api.test.sckools.com', 'http://127.0.0.1:3001', 'http://localhost:3001'];

/** Storage for staging and production. Add a project's origin here, deliberately, when one is created. */
const OWNER_STORAGE = [
  'https://pnczxkyteaocpdoufwyz.storage.supabase.co',
  'https://oljrqinbjhpysgfwmtxw.storage.supabase.co',
];

/** Local development: MinIO, and APIs that move ports per worktree. */
const DEV = ['http://127.0.0.1:*', 'http://localhost:*'];

const isOwnerConsole = (pathname: string) => pathname === '/platform' || pathname.startsWith('/platform/');

export function connectSrc(pathname: string, dev: boolean): string {
  return [
    `'self'`,
    ...API,
    ...(isOwnerConsole(pathname) ? OWNER_STORAGE : []),
    ...(dev ? DEV : []),
    ...(dev && isOwnerConsole(pathname) ? ['http://localhost:9000'] : []),
  ].join(' ');
}
