'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';

/**
 * Putting a school on its own address, end to end.
 *
 * The order on screen is the order the operator must actually work in: add the
 * name, hand over the DNS record, attach it at the host, then verify. Verify
 * reads real DNS and refuses to mark anything LIVE until the record resolves
 * here — a domain flipped early takes the school's whole site down with a 404
 * and gives no clue why.
 */

interface DomainRow {
  id: string;
  hostname: string;
  type: string;
  status: 'PENDING' | 'LIVE' | 'ERROR';
  isPrimary: boolean;
  createdAt: string;
  instructions: { kind: 'A' | 'CNAME'; host: string; value: string; note: string; alsoRequired: string };
}
interface DomainsResponse {
  school: { id: string; name: string; slug: string };
  platformHost: string;
  cnameTarget: string;
  domains: DomainRow[];
}

const badge = (tone: 'good' | 'bad' | 'warn' | 'info') =>
  ({
    good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    bad: 'bg-rose-50 text-rose-700 ring-rose-200',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
    info: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  })[tone];

export function DomainsCard({ schoolId }: { schoolId: string }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [hostname, setHostname] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; detail: string } | null>(null);

  const key = ['owner-domains', schoolId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<DomainsResponse>(`/owner/schools/${schoolId}/domains`) });

  const add = useMutation({
    mutationFn: (h: string) => api.post<DomainsResponse>(`/owner/schools/${schoolId}/domains`, { hostname: h }),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      setHostname('');
      setOpen(d.domains.find((x) => x.status === 'PENDING')?.id ?? null);
    },
  });

  const verify = useMutation({
    mutationFn: (id: string) =>
      api.post<DomainsResponse & { ok: boolean; detail: string }>(
        `/owner/schools/${schoolId}/domains/${id}/verify`,
        {},
      ),
    onSuccess: (d, id) => {
      qc.setQueryData(key, d);
      setResult({ id, ok: d.ok, detail: d.detail });
    },
  });

  const primary = useMutation({
    mutationFn: (id: string) => api.post<DomainsResponse>(`/owner/schools/${schoolId}/domains/${id}/primary`, {}),
    onSuccess: (d) => qc.setQueryData(key, d),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<DomainsResponse>(`/owner/schools/${schoolId}/domains/${id}`),
    onSuccess: (d) => qc.setQueryData(key, d),
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-base font-bold text-slate-900">Domains</h3>
        <p className="mt-1 text-sm text-slate-500">Loading…</p>
      </div>
    );
  }
  const d = q.data;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="text-base font-bold text-slate-900">Domains</h3>
      <p className="mt-1 text-sm text-slate-500">
        The school is always reachable at{' '}
        <span className="font-mono text-xs text-slate-700">{d.platformHost}</span>. Add its own domain below.
      </p>

      <ul className="mt-4 divide-y divide-slate-100">
        {d.domains.map((row) => (
          <li key={row.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-slate-800">{row.hostname}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${badge(
                  row.status === 'LIVE' ? 'good' : row.status === 'ERROR' ? 'bad' : 'warn',
                )}`}
              >
                {row.status}
              </span>
              {row.isPrimary && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${badge('info')}`}>
                  Primary
                </span>
              )}
              <div className="ml-auto flex flex-wrap gap-1.5">
                <button
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                >
                  {open === row.id ? 'Hide setup' : 'Setup'}
                </button>
                <button
                  className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  onClick={() => verify.mutate(row.id)}
                  disabled={verify.isPending}
                >
                  {verify.isPending && verify.variables === row.id ? 'Checking DNS…' : 'Verify'}
                </button>
                {row.status === 'LIVE' && !row.isPrimary && (
                  <button
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    onClick={() => primary.mutate(row.id)}
                  >
                    Make primary
                  </button>
                )}
                <button
                  className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  onClick={() => {
                    if (confirm(`Remove ${row.hostname}? The school stays reachable at ${d.platformHost}.`)) {
                      remove.mutate(row.id);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>

            {result?.id === row.id && (
              <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
                {result.ok ? `✓ Live — ${result.detail}` : result.detail}
              </p>
            )}

            {open === row.id && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-bold text-slate-800">1 · Add this DNS record at the registrar</p>
                <table className="mt-1.5 w-full text-left font-mono text-[11.5px]">
                  <tbody>
                    <tr><td className="pr-3 text-slate-400">Type</td><td className="font-bold text-slate-800">{row.instructions.kind}</td></tr>
                    <tr><td className="pr-3 text-slate-400">Name</td><td className="font-bold text-slate-800">{row.instructions.host}</td></tr>
                    <tr><td className="pr-3 text-slate-400">Value</td><td className="font-bold text-slate-800">{row.instructions.value}</td></tr>
                  </tbody>
                </table>
                <p className="mt-1.5">{row.instructions.note}</p>
                <p className="mt-2.5 font-bold text-slate-800">2 · Attach it at the host</p>
                <p className="mt-1">{row.instructions.alsoRequired}</p>
                <p className="mt-2.5 font-bold text-slate-800">3 · Verify</p>
                <p className="mt-1">
                  Press Verify above. It reads live DNS and only marks the domain LIVE once the record actually points
                  here — propagation can take up to an hour.
                </p>
              </div>
            )}
          </li>
        ))}
        {d.domains.length === 0 && (
          <li className="py-3 text-sm text-slate-400">No custom domain yet.</li>
        )}
      </ul>

      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (hostname.trim()) add.mutate(hostname.trim());
        }}
      >
        <input
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="stmarys.edu.in"
          aria-label="Domain to add"
          className="min-w-[200px] flex-1 rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-slate-900 focus:outline-none"
        />
        <button
          type="submit"
          disabled={add.isPending || !hostname.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add domain'}
        </button>
      </form>
      {add.error && <p className="mt-2 text-xs font-medium text-rose-600">{(add.error as Error).message}</p>}
      {primary.error && <p className="mt-2 text-xs font-medium text-rose-600">{(primary.error as Error).message}</p>}
    </div>
  );
}
