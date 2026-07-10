'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api';

/**
 * sckools.com/owner — one password, straight into the console. The password
 * lives in the API's OWNER_GATE_PASSWORD env var; email+TOTP login remains at
 * /platform/login as the fallback.
 */
export default function OwnerGatePage() {
  const router = useRouter();
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const setTokens = useAuthStore((s) => s.setTokens);
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'checking'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setError(null);
    setState('checking');
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string }>('/owner/auth/gate', { password });
      setTokens({ ...res, audience: 'platform' });
      router.replace('/platform');
    } catch (err) {
      const ae = err as ApiError;
      setState('idle');
      if (ae.status === 503) setError('The gate is not enabled on this deployment — use email login below.');
      else if (ae.status === 429) setError('Too many attempts — wait a minute and try again.');
      else setError('Wrong password.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-teal-50/40 px-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-9 text-center shadow-xl">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-teal-500 to-violet-600 text-2xl font-black text-white">
          S
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-teal-600">sckools.com/owner</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Owner access</h1>
        <p className="mt-2 text-sm text-slate-500">One password, straight to the console.</p>
        <form onSubmit={unlock}>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            aria-label="Owner password"
            className="mt-5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-lg tracking-[0.3em] text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
          />
          {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={state === 'checking'}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 py-3 text-sm font-bold text-white shadow-lg shadow-teal-600/30 transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            {state === 'checking' ? 'Checking…' : 'Enter console →'}
          </button>
        </form>
        <a href="/platform/login" className="mt-5 inline-block text-xs font-medium text-slate-400 hover:text-teal-600">
          Use email login instead →
        </a>
      </div>
    </div>
  );
}
