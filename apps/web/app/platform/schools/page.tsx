'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Shape returned by GET /owner/schools (Task 3 contract).
 * Declared locally — the web app cannot import API service types.
 */
interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  features: string[];
}

/* Only tones .sk-pill defines — 'success' is not one of them and would have
   rendered as bare text. */
const TIER_TONE: Record<SchoolRow['tier'], 'neutral' | 'info' | 'good'> = {
  BASIC: 'neutral',
  STANDARD: 'info',
  PRO: 'good',
};

const TIER_LABEL: Record<SchoolRow['tier'], string> = {
  BASIC: 'Basic',
  STANDARD: 'Standard',
  PRO: 'Pro',
};

export default function SchoolsListPage() {
  // Session state, not the token itself — the refresh token is an HttpOnly
  // cookie the client cannot read.
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });

  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-schools'],
    queryFn: () => api.get<SchoolRow[]>('/owner/schools'),
    enabled: signedIn,
  });

  const rows = data ?? [];

  return (
    <>
      <header className="sk-own-head">
        <div>
          <h1>Schools</h1>
          <p>
            Every school on Sckools — {rows.length} {rows.length === 1 ? 'school' : 'schools'}.
            Content, features and domains are managed per school.
          </p>
        </div>
        <Link href="/platform/onboard" className="sk-own-btn" data-kind="primary">
          <Plus size={14} aria-hidden="true" /> Add a school
        </Link>
      </header>

      {isLoading && <p className="sk-own-state">Loading the schools…</p>}
      {error && (
        <p className="sk-own-state" data-tone="err">
          <b>The list could not load.</b>
          {(error as Error).message}
        </p>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <p className="sk-own-state">
          <b>No schools yet.</b>
          The first one you add appears here with its domain and plan.
        </p>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="sk-tblwrap">
          <table className="sk-tbl">
            <thead>
              <tr>
                <th>School</th>
                <th>Domain</th>
                <th>Plan</th>
                <th data-priority="2">Features</th>
                <th>Status</th>
                <th className="acts">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b></td>
                  <td className="sk-muted">{s.primaryDomain ?? '—'}</td>
                  <td><span className="sk-pill" data-tone={TIER_TONE[s.tier]}>{TIER_LABEL[s.tier]}</span></td>
                  <td data-priority="2" className="sk-muted">
                    {s.features.length > 0 ? s.features.join(' · ') : '—'}
                  </td>
                  <td className="sk-muted">{s.status}</td>
                  <td className="acts">
                    <Link href={`/platform/schools/${s.id}`} className="sk-own-btn">Manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
