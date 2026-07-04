'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  firstName: string;
  lastName: string;
  admissionNo: string;
  rollNo: string | null;
  className: string | null;
  photoUrl: string | null;
}

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
      <header>
        <h1 className="text-2xl font-bold text-slate-900">My profile</h1>
        <p className="mt-1 text-sm text-slate-500">Your student information (read-only).</p>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading profile…</p>}
      {error && (
        <p className="text-sm text-rose-500">{(error as Error).message}</p>
      )}

      {profile && (
        <Card className="max-w-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-4">
              {/* Photo or initials avatar */}
              {profile.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.photoUrl}
                  alt={`${profile.firstName} ${profile.lastName}`}
                  className="h-16 w-16 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-teal-100 flex items-center justify-center text-xl font-bold text-teal-700 border border-teal-200">
                  {initials(profile.firstName, profile.lastName)}
                </div>
              )}
              <div>
                <CardTitle className="text-lg">
                  {profile.firstName} {profile.lastName}
                </CardTitle>
                {profile.className && (
                  <p className="text-sm text-slate-500">{profile.className}</p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <dt className="text-slate-500">Admission no.</dt>
                <dd className="font-medium text-slate-800 font-mono">{profile.admissionNo}</dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <dt className="text-slate-500">Roll no.</dt>
                <dd className="font-medium text-slate-800">
                  {profile.rollNo ?? <span className="text-slate-400">—</span>}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Class</dt>
                <dd className="font-medium text-slate-800">
                  {profile.className ?? <span className="text-slate-400">—</span>}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
