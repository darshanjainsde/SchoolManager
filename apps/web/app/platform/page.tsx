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

interface Lead {
  id: string;
  name: string | null;
  phone: string;
  school: string | null;
  interest: string | null;
  source: string;
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  createdAt: string;
}

interface MarketingConfigRow {
  priceBasicUsd: number; priceBasicInr: number;
  priceStdUsd: number; priceStdInr: number;
  priceProUsd: number; priceProInr: number;
  contactEmail: string; contactPhone: string;
}

const TIER_TONE: Record<SchoolMetrics['tier'], string> = {
  BASIC: 'bg-sky-100 text-sky-700',
  STANDARD: 'bg-teal-100 text-teal-700',
  PRO: 'bg-violet-100 text-violet-700',
};

const LEAD_TONE: Record<Lead['status'], string> = {
  NEW: 'bg-amber-100 text-amber-700',
  CONTACTED: 'bg-teal-100 text-teal-700',
  CLOSED: 'bg-slate-100 text-slate-500',
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

  const leads = useQuery({
    queryKey: ['owner-leads'],
    queryFn: () => api.get<Lead[]>('/owner/leads'),
    enabled: signedIn,
  });

  const config = useQuery({
    queryKey: ['owner-marketing-config'],
    queryFn: () => api.get<MarketingConfigRow>('/owner/marketing-config'),
    enabled: signedIn,
  });

  const leadStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Lead['status'] }) =>
      api.patch(`/owner/leads/${id}`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['owner-leads'] });
      void qc.invalidateQueries({ queryKey: ['owner-overview'] });
    },
    onError: (e) => toast.error((e as Error).message),
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

      {overview.isLoading && <div className="sk-muted">Loading…</div>}
      {overview.error && <div className="text-sm text-rose-600">{(overview.error as Error).message}</div>}

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

          {/* Marketing leads */}
          <h2 className="sk-eyebrow" style={{ margin: '30px 0 10px' }}>
            Marketing leads · from sckools.com callback forms
          </h2>
          <div className="sk-tblwrap">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">School</th>
                  <th className="px-4 py-3">Interest</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {(leads.data ?? []).map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{l.name ?? '—'}</td>
                    <td className="px-4 py-3"><a className="text-teal-700 hover:underline" href={`tel:${l.phone.replace(/\s/g, '')}`}>{l.phone}</a></td>
                    <td className="px-4 py-3 text-slate-600">{l.school ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{l.interest ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(l.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <select
                        value={l.status}
                        onChange={(e) => leadStatus.mutate({ id: l.id, status: e.target.value as Lead['status'] })}
                        className={`rounded-full border-0 px-2.5 py-1 text-[11px] font-bold ${LEAD_TONE[l.status]}`}
                      >
                        <option value="NEW">NEW</option>
                        <option value="CONTACTED">CONTACTED</option>
                        <option value="CLOSED">CLOSED</option>
                      </select>
                    </td>
                  </tr>
                ))}
                {leads.data?.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No leads yet — they&rsquo;ll appear the moment someone requests a callback on sckools.com.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Marketing site settings */}
          {config.data && <MarketingSettings initial={config.data} onSaved={() => void qc.invalidateQueries({ queryKey: ['owner-marketing-config'] })} />}
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

function MarketingSettings({ initial, onSaved }: { initial: MarketingConfigRow; onSaved: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const [form, setForm] = useState({ ...initial });

  const save = useMutation({
    mutationFn: () =>
      api.put('/owner/marketing-config', {
        priceBasicUsd: Number(form.priceBasicUsd), priceBasicInr: Number(form.priceBasicInr),
        priceStdUsd: Number(form.priceStdUsd), priceStdInr: Number(form.priceStdInr),
        priceProUsd: Number(form.priceProUsd), priceProInr: Number(form.priceProInr),
        contactEmail: form.contactEmail, contactPhone: form.contactPhone,
      }),
    onSuccess: () => {
      toast.success('Saved — live on sckools.com within a minute');
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const num = (key: keyof MarketingConfigRow) => ({
    value: String(form[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <div className="mt-8 sk-own-panel">
      <h2 className="text-lg font-bold text-slate-900">
        Marketing site settings <span className="text-xs font-semibold text-slate-500">· pricing &amp; contact shown on sckools.com, live within a minute</span>
      </h2>
      <p className="sk-own-sub">
        Prices are <b>per year</b>. Schools in India are billed the ₹ INR figure, everyone else the $ USD figure —
        other countries see the USD price converted live on sckools.com/pricing.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ['Basic', 'priceBasicUsd', 'priceBasicInr'],
          ['Standard', 'priceStdUsd', 'priceStdInr'],
          ['Pro', 'priceProUsd', 'priceProInr'],
        ] as const).map(([tier, usdKey, inrKey]) => (
          <div key={usdKey} className="rounded-xl border border-slate-200 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{tier} — per year</div>
            <label htmlFor={inrKey} className="mt-2 block text-[11px] font-semibold text-slate-400">India (₹ INR)</label>
            <MoneyInput id={inrKey} symbol="₹" {...num(inrKey)} />
            <label htmlFor={usdKey} className="mt-3 block text-[11px] font-semibold text-slate-400">Rest of world ($ USD)</label>
            <MoneyInput id={usdKey} symbol="$" {...num(usdKey)} />
          </div>
        ))}
        <div className="rounded-xl border border-slate-200 p-3">
          <label htmlFor="contactEmail" className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">Public contact email</label>
          <input id="contactEmail" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className={`${FIELD} mt-1`} />
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <label htmlFor="contactPhone" className="block text-[11px] font-bold uppercase tracking-wide text-slate-500">Public contact phone</label>
          <input id="contactPhone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="+91 ..." className={`${FIELD} mt-1`} />
        </div>
        <div className="flex items-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
