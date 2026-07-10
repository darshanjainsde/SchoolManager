'use client';

import { useMemo, useState } from 'react';
import type { DirectorySchool } from '@/lib/public-api';
import { OWNER_HOST, ownerHref, schoolHref } from '@/lib/hosts';

interface Props {
  schools: DirectorySchool[];
  apiHealthy: boolean;
}

const TIER_LABEL: Record<DirectorySchool['tier'], string> = {
  BASIC: 'Basic',
  STANDARD: 'Standard',
  PRO: 'Pro',
};

const TIER_TONE: Record<DirectorySchool['tier'], string> = {
  BASIC: 'bg-slate-100 text-slate-600',
  STANDARD: 'bg-sky-100 text-sky-700',
  PRO: 'bg-emerald-100 text-emerald-700',
};

export default function PlatformLanding({ schools, apiHealthy }: Props) {
  const [selected, setSelected] = useState<string>(schools[0]?.slug ?? '');
  const current = useMemo(
    () => schools.find((s) => s.slug === selected) ?? null,
    [schools, selected],
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-12">
      <div className="mx-auto max-w-5xl space-y-10">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-teal-500 to-violet-600 text-lg font-black text-white">
              S
            </span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Sckools</h1>
              <p className="text-sm text-slate-500">Multi-school website & management platform</p>
            </div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              apiHealthy ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
            }`}
          >
            API {apiHealthy ? '● online' : '● offline'}
          </span>
        </header>

        <p className="text-slate-600">
          Choose where to go — manage the whole platform, sign in to a school&rsquo;s admin, or
          visit a school&rsquo;s public website.
        </p>

        {/* 1 — Owner portal */}
        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="inline-block rounded bg-violet-200 px-2 py-0.5 font-mono text-xs text-violet-700">
                {OWNER_HOST}
              </span>
              <h2 className="mt-2 text-lg font-bold text-slate-900">Platform Owner Portal</h2>
              <p className="mt-1 max-w-lg text-sm text-slate-600">
                Manage every school, add new schools, control features &amp; tiers, and moderate the
                cross-school Connect events feed.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Demo: <span className="font-mono">owner@skoolos.local</span> /{' '}
                <span className="font-mono">OwnerPassw0rd!</span> · TOTP optional
              </p>
            </div>
            <a
              href={ownerHref('/platform/login')}
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              Sign in as Owner →
            </a>
          </div>
        </section>

        {/* 2 — Registered school portals */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">School Admin Portals</h2>
            <span className="text-xs text-slate-400">{schools.length} registered</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Pick a school to sign in to its admin portal.
          </p>

          {schools.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
              No live schools yet. Add one from the owner portal.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="school-picker" className="mb-1 block text-xs font-medium text-slate-500">
                  School
                </label>
                <select
                  id="school-picker"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
                >
                  {schools.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {current && (
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${TIER_TONE[current.tier]}`}
                    title="Subscription tier"
                  >
                    {TIER_LABEL[current.tier]} plan
                  </span>
                  <a
                    href={schoolHref(current.host, '/login')}
                    className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
                  >
                    Sign in →
                  </a>
                </div>
              )}
            </div>
          )}

          {current && (
            <p className="mt-3 text-xs text-slate-500">
              Demo admin: <span className="font-mono">admin@{current.slug}.test</span> /{' '}
              <span className="font-mono">Passw0rd!</span>
            </p>
          )}
        </section>

        {/* 3 — School websites */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">School Websites</h2>
          <p className="mt-1 text-sm text-slate-600">Visit any school&rsquo;s public site.</p>

          {schools.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
              No live schools to preview yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {schools.map((s) => (
                <a
                  key={s.slug}
                  href={schoolHref(s.host)}
                  className="group flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-teal-300 hover:bg-teal-50"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{s.name}</div>
                    <div className="font-mono text-xs text-slate-400">{s.host}</div>
                  </div>
                  <span className="text-slate-400 transition group-hover:text-teal-600">↗</span>
                </a>
              ))}
            </div>
          )}
        </section>

        {/* Dev tools footer */}
        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500">
          <span className="font-medium text-slate-600">Dev tools:</span>
          <a className="hover:text-teal-600" href="http://localhost:3001/api/docs" target="_blank" rel="noreferrer">
            Swagger ↗
          </a>
          <a className="hover:text-teal-600" href="http://localhost:8025" target="_blank" rel="noreferrer">
            MailHog ↗
          </a>
          <a className="hover:text-teal-600" href="http://localhost:9001" target="_blank" rel="noreferrer">
            MinIO ↗
          </a>
        </footer>
      </div>
    </main>
  );
}
