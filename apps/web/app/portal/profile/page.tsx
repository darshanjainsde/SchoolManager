'use client';
import { useQuery } from '@tanstack/react-query';
import type { Profile } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalProfilePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => api.get<Profile>('/me/profile'),
    enabled: !!host,
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>My profile</h1>
        <p>Your student information (read-only).</p>
      </header>

      {isLoading && <p className="sk-state">Loading profile…</p>}
      {error && (
        <p className="sk-state err">{(error as Error).message}</p>
      )}

      {profile && (
        <div className="sk-card max-w-md">
          <div className="sk-card-h pb-3">
            <div className="flex items-center gap-4">
              {/* Photo or initials avatar */}
              {profile.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.photoUrl}
                  alt={`${profile.firstName} ${profile.lastName}`}
                  className="h-16 w-16 rounded-full object-cover border border-[var(--sk-line)]"
                />
              ) : (
                <div
                  className="h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold border"
                  style={{
                    background: 'var(--sk-brand-tint)',
                    color: 'var(--sk-brand-2)',
                    borderColor: 'var(--sk-brand)',
                  }}
                >
                  {initials(profile.firstName, profile.lastName)}
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-[var(--sk-ink)]">
                  {profile.firstName} {profile.lastName}
                </h3>
                {profile.className && (
                  <p className="text-sm text-[var(--sk-ink-3)]">{profile.className}</p>
                )}
              </div>
            </div>
          </div>
          <div className="sk-card-b">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between border-b border-[var(--sk-line)] pb-3">
                <dt className="text-[var(--sk-ink-3)]">Admission no.</dt>
                <dd className="font-medium text-[var(--sk-ink)] font-mono">{profile.admissionNo}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-[var(--sk-line)] pb-3">
                <dt className="text-[var(--sk-ink-3)]">Roll no.</dt>
                <dd className="font-medium text-[var(--sk-ink)]">
                  {profile.rollNo ?? <span className="text-[var(--sk-ink-3)]">—</span>}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--sk-ink-3)]">Class</dt>
                <dd className="font-medium text-[var(--sk-ink)]">
                  {profile.className ?? <span className="text-[var(--sk-ink-3)]">—</span>}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
