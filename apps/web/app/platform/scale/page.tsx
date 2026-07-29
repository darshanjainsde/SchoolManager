'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';
import '../../sk-theme.css';

interface SchoolMetrics {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  storageBytes: number;
  enquiries: number;
  newEnquiries: number;
  events: number;
  students: number;
  images: number;
}

interface OverviewResponse {
  totals: {
    schools: number;
    live: number;
    storageBytes: number;
    enquiriesThisMonth: number;
    newLeads: number;
    students: number;
    images: number;
  };
  schools: SchoolMetrics[];
}

const TIER_TONE: Record<SchoolMetrics['tier'], string> = {
  BASIC: 'info',
  STANDARD: 'good',
  PRO: 'warn',
};

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(1) + ' GB';
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(0) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

/** Smallest ladder rung >= current; null once current is past the top rung ("top tier"). */
function nextMilestone(current: number, ladder: number[]): number | null {
  return ladder.find((m) => m >= current) ?? null;
}

interface GrowthBarProps {
  label: string;
  current: number;
  ladder: number[];
}

function GrowthBar({ label, current, ladder }: GrowthBarProps) {
  const target = nextMilestone(current, ladder);
  const pct = target === null ? 100 : Math.min(100, Math.round((current / target) * 100));
  const approaching = pct > 80;

  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>{label}</h3>
      </div>
      <div className="sk-card-b">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.03em' }}>
            {current.toLocaleString()}
          </span>
          <span className="sk-muted">
            {target !== null ? `next milestone: ${target.toLocaleString()}` : 'top tier reached'}
          </span>
        </div>
        <div
          style={{
            width: '100%',
            height: 10,
            borderRadius: 999,
            background: 'var(--sk-line)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 999,
              background: approaching ? 'var(--sk-amber)' : 'var(--sk-brand)',
              transition: 'width .6s',
            }}
          />
        </div>
        <div className="sk-muted" style={{ fontSize: 12 }}>
          {pct}%{target !== null && ` — ${(target - current).toLocaleString()} to go`}
        </div>
      </div>
    </div>
  );
}

interface Checkpoint {
  key: string;
  title: string;
  min: number;
  max: number | null;
  focus: string;
  build: string[];
  ask: string[];
}

const CHECKPOINTS: Checkpoint[] = [
  {
    key: 'pilot',
    title: 'CHECKPOINT 1 — Pilot (1–5 schools)',
    min: 1,
    max: 5,
    focus: 'Prove the product with real schools; onboard manually.',
    build: ['Staging testing loop', 'Fix pilot feedback', 'Polish core flows'],
    ask: [
      'Onboard a new test school on staging',
      'Fix the bug where <X>',
      'Add SMTP so invite emails actually send',
    ],
  },
  {
    key: 'early-traction',
    title: 'CHECKPOINT 2 — Early traction (5–25 schools)',
    min: 5,
    max: 25,
    focus: 'Reduce manual work, harden security.',
    build: [
      'Self-serve school signup',
      'RLS on all tables',
      'Email domain auth (SPF/DKIM)',
      'Server-side pagination on students/teachers',
    ],
    ask: [
      'Build a self-serve school signup flow',
      'Add RLS policies to the attendance/exam/result tables',
      'Add server-side search and pagination to the students list',
      'Set up SPF/DKIM for sckools.com email deliverability',
    ],
  },
  {
    key: 'growth',
    title: 'CHECKPOINT 3 — Growth (25–100 schools)',
    min: 25,
    max: 100,
    focus: 'Engagement + efficiency at volume.',
    build: [
      'The Android app (Expo)',
      'WhatsApp notification channel',
      'Bulk CSV student import',
      'Per-school analytics for admins',
    ],
    ask: [
      'Build the Teacher and Student Android apps with Expo',
      'Add a WhatsApp channel to the notification service',
      'Build a CSV import wizard for students',
      'Add DB connection pooling for more concurrent schools',
    ],
  },
  {
    key: 'scale',
    title: 'CHECKPOINT 4 — Scale (100–500 schools)',
    min: 100,
    max: 500,
    focus: 'Performance + reliability.',
    build: [
      'Redis caching for tenant lookups',
      'Move images to a CDN',
      'CDN-cache the public pages — every view is a MISS today',
      'Per-host data cache + revalidate-on-save for school sites',
      'Monitoring & error tracking',
      'Automated backups',
      'Load testing',
    ],
    ask: [
      'Cache tenant host lookups in Redis',
      'Serve school images through a CDN',
      'CDN-cache the public school pages: middleware Cache-Control on public paths first, proven on two staging hosts, then the /s/[host] ISR refactor',
      'Cache /public/site per host with a tag, and revalidate that tag when a school saves its website',
      'Add error tracking and uptime monitoring',
      'Load-test the API to 500 schools',
    ],
  },
  {
    key: 'platform',
    title: 'CHECKPOINT 5 — Platform (500+ schools)',
    min: 500,
    max: null,
    focus: 'Run it like a business.',
    build: [
      'Automated billing & subscriptions',
      'Usage metering',
      'DB read replicas / sharding',
      'An internal ops console',
      'SLA & on-call',
    ],
    ask: [
      'Automate subscription billing per school',
      'Add usage metering and plan limits',
      'Set up a read replica for the reporting queries',
      'Build an internal ops/status console',
    ],
  },
];

function currentCheckpointKey(schoolCount: number): string {
  const hit = CHECKPOINTS.find((c) => schoolCount >= c.min && (c.max === null || schoolCount <= c.max));
  return hit?.key ?? CHECKPOINTS[0].key;
}

export default function PlatformScalePage() {
  // Session state, not the token itself — the refresh token is an HttpOnly
  // cookie the client cannot read.
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });

  const overview = useQuery({
    queryKey: ['owner-overview'],
    queryFn: () => api.get<OverviewResponse>('/owner/overview'),
    enabled: signedIn,
  });

  const schoolCount = overview.data?.totals.schools ?? 0;
  const hereKey = currentCheckpointKey(schoolCount);

  const sortedSchools = overview.data ? [...overview.data.schools].sort((a, b) => b.students - a.students) : [];

  return (
    <div className="skosx">
      <div style={{ padding: '32px' }}>
        <header className="sk-pagehead">
          <h1>Scale</h1>
          <p>Track platform growth and plan what&rsquo;s next.</p>
        </header>

        {overview.isLoading && <p className="sk-state">Loading platform metrics…</p>}
        {overview.error && <p className="sk-state err">{(overview.error as Error).message}</p>}
        {overview.data && overview.data.totals.schools === 0 && (
          <p className="sk-state">No schools onboarded yet — growth metrics will appear here once the first school goes live.</p>
        )}

        {overview.data && overview.data.totals.schools > 0 && (
          <>
            {/* Growth bars */}
            <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 20 }}>
              <GrowthBar label="Schools" current={overview.data.totals.schools} ladder={[5, 25, 100, 500]} />
              <GrowthBar label="Students" current={overview.data.totals.students} ladder={[100, 1000, 10000, 50000]} />
              <GrowthBar label="Images" current={overview.data.totals.images} ladder={[100, 1000, 10000, 100000]} />
            </div>

            {/* Per-school breakdown */}
            <div className="sk-card" style={{ marginBottom: 20 }}>
              <div className="sk-card-h">
                <h3>Per-school breakdown</h3>
              </div>
              <div className="sk-card-b">
                {sortedSchools.map((s) => (
                  <div key={s.id} className="sk-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">{s.name}</div>
                      <div className="meta">{s.primaryDomain ?? s.slug}</div>
                    </div>
                    <span className="sk-pill" data-tone={TIER_TONE[s.tier]}>
                      {s.tier}
                    </span>
                    <div style={{ textAlign: 'right', minWidth: 70 }}>
                      <div style={{ fontWeight: 700 }}>{s.students.toLocaleString()}</div>
                      <div className="meta">students</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 70 }}>
                      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--sk-brand-2)' }}>
                        {s.images.toLocaleString()}
                      </div>
                      <div className="meta">images</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 70 }}>
                      <div style={{ fontWeight: 700 }}>{formatBytes(s.storageBytes)}</div>
                      <div className="meta">storage</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Scale playbook */}
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 12 }}>
                Scale playbook
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {CHECKPOINTS.map((c) => (
                  <div key={c.key} className="sk-card">
                    <div
                      className="sk-card-h"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                    >
                      <h3>{c.title}</h3>
                      {c.key === hereKey && (
                        <span className="sk-pill" data-tone="good">
                          You are here
                        </span>
                      )}
                    </div>
                    <div className="sk-card-b">
                      <p className="sk-muted" style={{ margin: 0 }}>
                        Focus: {c.focus}
                      </p>
                      <div>
                        <div className="sk-lab" style={{ marginBottom: 6 }}>
                          What to build
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {c.build.map((b) => (
                            <li key={b} style={{ fontSize: 13.5 }}>
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="sk-lab" style={{ marginBottom: 6 }}>
                          Ask Claude
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {c.ask.map((a) => (
                            <li key={a} style={{ fontSize: 13.5, fontFamily: 'monospace' }}>
                              &ldquo;{a}&rdquo;
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
