'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ExternalLink, Zap, Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST, schoolHref } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

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
  /** Work queues the console can link into — see the API's OwnerOverviewService. */
  attention: {
    newLeads: number;
    followUpsDue: number;
    pendingEvents: number;
    pendingBlogPosts: number;
    schoolsInSetup: number;
    leadsWonThisMonth: number;
  };
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
  BASIC: 'bg-sky-100 text-sky-700',
  STANDARD: 'bg-teal-100 text-teal-700',
  PRO: 'bg-violet-100 text-violet-700',
};


function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(1) + ' GB';
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(0) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

export default function PlatformDashboardPage() {
  // Session state, not the token itself — the refresh token is an HttpOnly
  // cookie the client cannot read.
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [impersonating, setImpersonating] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['owner-overview'],
    queryFn: () => api.get<OverviewResponse>('/owner/overview'),
    enabled: signedIn,
  });




  async function impersonate(school: SchoolMetrics) {
    setImpersonating(school.id);
    try {
      const { url } = await api.post<{ url: string }>(`/owner/schools/${school.id}/impersonate`);
      window.open(url, '_blank', 'noopener');
      toast.success(`Opening ${school.name} admin — link is single-use, valid 15 minutes`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImpersonating(null);
    }
  }

  async function downloadCsv(school: SchoolMetrics) {
    try {
      const csv = await api.get<string>(`/owner/schools/${school.id}/enquiries.csv`);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${school.slug}-enquiries.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="sk-own-h1">Dashboard</h1>
          <p className="sk-own-sub">Every school, every lead — live.</p>
        </div>
        {/* The class goes on the link itself — a span inside it would take the
            styling while the focus ring stayed on an invisible wrapper. */}
        <Link href="/platform/onboard" className="sk-own-btn" data-kind="primary">
          <Plus size={14} aria-hidden="true" /> Add a school
        </Link>
      </div>

      {/* Not `isLoading`: a query between retries is neither loading nor
          errored, and would render the header over an empty page. */}
      {!overview.data && !overview.error && <div className="sk-muted">Loading…</div>}
      {overview.error && (
        <div className="sk-own-note" data-tone="warn">
          <span>
            Could not load metrics — {(overview.error as Error).message}.{' '}
            <button
              type="button"
              onClick={() => void overview.refetch()}
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                       color: 'var(--sk-brand-2)', fontWeight: 640 }}
            >
              Try again
            </button>
          </span>
        </div>
      )}

      {overview.data && (
        <>
          {/* KPI row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sk-own-panel">
              <div className="text-3xl font-bold">{overview.data.totals.live}</div>
              <div className="sk-muted">live schools <span className="text-teal-600 font-semibold">of {overview.data.totals.schools} total</span></div>
            </div>
            <div className="sk-own-panel">
              <div className="text-3xl font-bold tabular-nums">{formatBytes(overview.data.totals.storageBytes)}</div>
              <div className="sk-muted">storage used across all schools</div>
            </div>
            <div className="sk-own-panel">
              <div className="text-3xl font-bold tabular-nums">{overview.data.totals.enquiriesThisMonth}</div>
              <div className="sk-muted">enquiries this month</div>
            </div>
            <div className="sk-own-panel">
              <div className={`text-3xl font-bold tabular-nums ${overview.data.totals.newLeads > 0 ? 'text-amber-600' : ''}`}>{overview.data.totals.newLeads}</div>
              <div className="sk-muted">new marketing leads{overview.data.totals.newLeads > 0 && <span className="font-semibold text-amber-600"> · needs action</span>}</div>
            </div>
          </div>

          {/* School cards */}
          <h2 className="mb-3 mt-8 text-lg font-bold text-slate-900">Schools</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {overview.data.schools.map((s) => (
              <div key={s.id} className="sk-own-panel">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-violet-500 font-bold text-white">
                    {s.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{s.name}</div>
                    <div className="truncate font-mono text-xs text-slate-400">{s.primaryDomain ?? s.slug}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TIER_TONE[s.tier]}`}>{s.tier}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${s.status === 'LIVE' ? 'bg-teal-100 text-teal-700' : s.status === 'SUSPENDED' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                      {s.status}
                    </span>
                  </div>
                </div>

                <div className="my-4 grid grid-cols-4 gap-2 border-y border-slate-100 py-3 text-center">
                  <div><div className="font-bold tabular-nums">{formatBytes(s.storageBytes)}</div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">storage</div></div>
                  <div><div className="font-bold tabular-nums">{s.enquiries}</div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">enquiries</div></div>
                  <div><div className={`font-bold tabular-nums ${s.newEnquiries > 0 ? 'text-amber-600' : ''}`}>{s.newEnquiries}</div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">new</div></div>
                  <div><div className="font-bold tabular-nums">{s.events}</div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">events</div></div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {s.primaryDomain && (
                    <a href={schoolHref(s.primaryDomain)} target="_blank" rel="noreferrer" className="sk-own-btn">
                      <ExternalLink size={13} aria-hidden="true" /> Visit site
                    </a>
                  )}
                  <button type="button" className="sk-own-btn" data-kind="primary"
                    onClick={() => impersonate(s)} disabled={impersonating === s.id}>
                    <Zap size={13} aria-hidden="true" />
                    {impersonating === s.id ? 'Minting…' : 'Login as admin'}
                  </button>
                  <button type="button" className="sk-own-btn" onClick={() => downloadCsv(s)}>
                    <Download size={13} aria-hidden="true" /> Enquiries CSV
                  </button>
                  <Link href={`/platform/schools/${s.id}`} className="sk-own-btn">Manage</Link>
                </div>
              </div>
            ))}
          </div>
          <p className="sk-notice" style={{ marginTop: 12 }}>
            <b>Login as admin</b> opens the school&rsquo;s admin portal in a new tab via a single-use link (valid 15 minutes, audit-logged, no password shown). The session can&rsquo;t be refreshed past expiry.
          </p>

          {/* Leads and the sckools.com pricing/contact form each have their own
              tab now. The table that used to sit here offered a CLOSED status
              that no longer exists — the pipeline replaced it with WON/LOST. */}
          <h2 className="sk-eyebrow" style={{ margin: '30px 0 10px' }}>
            Elsewhere in the console
          </h2>
          <div className="sk-own-attention">
            <Link href="/platform/leads" className="sk-own-attn">
              <span className="n">{overview.data.attention.newLeads}</span>
              <div style={{ minWidth: 0 }}>
                <div className="t">Leads</div>
                <div className="s">callbacks from sckools.com</div>
              </div>
            </Link>
            <Link href="/platform/settings" className="sk-own-attn">
              <div style={{ minWidth: 0 }}>
                <div className="t">Settings</div>
                <div className="s">public pricing &amp; contact details</div>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Console fields are light-only. The explicit background/text colours matter:
 * without them the browser paints native inputs with its dark UA colours when
 * the OS is in dark mode, which made these boxes render grey on white.
 */
const FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 [color-scheme:light] focus:border-teal-500 focus:outline-none';

/** Number field with a currency symbol pinned inside, so ₹ vs $ is unmistakable. */
function MoneyInput({
  id,
  symbol,
  value,
  onChange,
}: {
  id: string;
  symbol: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="relative mt-1">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">
        {symbol}
      </span>
      <input
        id={id}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={onChange}
        className={`${FIELD} pl-7 font-semibold tabular-nums`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">
        / year
      </span>
    </div>
  );
}

