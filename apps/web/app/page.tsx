async function getApiHealth(): Promise<string> {
  const url = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/health';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return `error:${res.status}`;
    const data = (await res.json()) as { status?: string };
    return data.status ?? 'unknown';
  } catch (e) {
    return `unreachable:${(e as Error).message}`;
  }
}

export default async function HomePage() {
  const apiStatus = await getApiHealth();
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">SkoolOS</h1>
      <p className="text-lg text-slate-600">
        Multi-tenant School Management SaaS. This is the Phase 0 scaffold — auth, tenancy and
        domain features arrive in later phases.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-medium text-slate-500">API health</div>
        <div className="text-xl font-semibold">
          {apiStatus === 'ok' ? (
            <span className="text-emerald-600">● ok</span>
          ) : (
            <span className="text-rose-600">● {apiStatus}</span>
          )}
        </div>
      </div>
      <ul className="text-sm text-slate-600">
        <li>
          API:{' '}
          <a
            className="text-blue-600 underline"
            href={(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api/docs'}
          >
            Swagger docs
          </a>
        </li>
        <li>
          Mail UI:{' '}
          <a className="text-blue-600 underline" href="http://localhost:8025">
            MailHog
          </a>
        </li>
        <li>
          Object store:{' '}
          <a className="text-blue-600 underline" href="http://localhost:9001">
            MinIO console
          </a>
        </li>
      </ul>
    </main>
  );
}
