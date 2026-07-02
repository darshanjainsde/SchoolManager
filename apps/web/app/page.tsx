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

const PORTALS = [
  {
    title: 'Platform Owner Portal',
    description: 'Manage all schools, users, domains, and platform stats.',
    loginUrl: '/platform/login',
    loginLabel: 'Sign in as Owner',
    accent: 'bg-violet-50 border-violet-200',
    btnClass: 'bg-violet-600 hover:bg-violet-700 text-white',
    badge: 'owner.localhost',
    credentials: [
      { label: 'Email', value: 'owner@skoolos.local' },
      { label: 'Password', value: 'OwnerPassw0rd!' },
      { label: 'TOTP secret', value: 'AIRFGVZFLVAH6J2C' },
    ],
    note: 'Get a 6-digit TOTP from Google Authenticator / Authy using the secret above.',
  },
  {
    title: 'Acme School Portal',
    description: 'Classes, subjects, enrolments, grades, attendance and more.',
    loginUrl: 'http://acme.localhost:3000/login',
    loginLabel: 'Sign in to Acme',
    accent: 'bg-sky-50 border-sky-200',
    btnClass: 'bg-sky-600 hover:bg-sky-700 text-white',
    badge: 'acme.localhost:3000',
    credentials: [
      { label: 'Admin', value: 'admin@acme.test / Passw0rd!' },
      { label: 'Teacher', value: 'teacher@acme.test / Passw0rd!' },
      { label: 'Student', value: 'student@acme.test / Passw0rd!' },
      { label: 'Parent', value: 'parent@acme.test / Passw0rd!' },
    ],
    note: null,
  },
  {
    title: 'Beacon School Portal',
    description: 'A second tenant — identical features, isolated data.',
    loginUrl: 'http://beacon.localhost:3000/login',
    loginLabel: 'Sign in to Beacon',
    accent: 'bg-emerald-50 border-emerald-200',
    btnClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    badge: 'beacon.localhost:3000',
    credentials: [
      { label: 'Admin', value: 'admin@beacon.test / Passw0rd!' },
      { label: 'Teacher', value: 'teacher@beacon.test / Passw0rd!' },
      { label: 'Student', value: 'student@beacon.test / Passw0rd!' },
      { label: 'Parent', value: 'parent@beacon.test / Passw0rd!' },
    ],
    note: null,
  },
];

const DEV_TOOLS = [
  { label: 'Swagger API docs', href: 'http://localhost:3001/api/docs' },
  { label: 'MailHog (email UI)', href: 'http://localhost:8025' },
  { label: 'MinIO console (S3)', href: 'http://localhost:9001' },
];

export default async function HomePage() {
  const apiStatus = await getApiHealth();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-5xl space-y-10">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">SkoolOS</h1>
            <p className="mt-1 text-sm text-slate-500">Multi-tenant School Management SaaS — local dev launcher</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${apiStatus === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            API {apiStatus === 'ok' ? '● healthy' : `● ${apiStatus}`}
          </span>
        </div>

        {/* Portal cards */}
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-3">
          {PORTALS.map((p) => (
            <div key={p.title} className={`rounded-xl border p-6 space-y-4 ${p.accent}`}>
              <div className="space-y-1">
                <span className="inline-block rounded bg-slate-200 px-2 py-0.5 font-mono text-xs text-slate-600">{p.badge}</span>
                <h2 className="text-lg font-semibold text-slate-900">{p.title}</h2>
                <p className="text-sm text-slate-600">{p.description}</p>
              </div>

              <div className="space-y-1 rounded-lg bg-white/70 p-3 text-xs font-mono text-slate-700">
                {p.credentials.map((c) => (
                  <div key={c.label}>
                    <span className="font-semibold text-slate-500">{c.label}:</span> {c.value}
                  </div>
                ))}
              </div>

              {p.note && (
                <p className="text-xs text-slate-500 italic">{p.note}</p>
              )}

              <a
                href={p.loginUrl}
                className={`block w-full rounded-lg px-4 py-2 text-center text-sm font-medium transition-colors ${p.btnClass}`}
              >
                {p.loginLabel} →
              </a>
            </div>
          ))}
        </div>

        {/* Dev tools */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Dev Tools</h3>
          <div className="flex flex-wrap gap-3">
            {DEV_TOOLS.map((t) => (
              <a
                key={t.label}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
              >
                {t.label} ↗
              </a>
            ))}
          </div>
        </div>

      </div>
    </main>
  );
}
