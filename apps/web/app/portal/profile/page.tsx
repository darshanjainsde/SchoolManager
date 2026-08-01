'use client';
import { useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvatarUploadResponse, Profile } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** Mirrors MAX_AVATAR_BYTES on POST /me/photo — checked client-side so an
 *  oversized pick fails instantly instead of after a doomed round-trip. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalProfilePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => api.get<Profile>('/me/profile'),
    enabled: !!host,
    staleTime: 60_000,
  });

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError('Profile photos must be images.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setUploadError('Keep photos under 2MB.');
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // api.request, not api.post — post JSON-encodes every body; request
      // passes FormData through and skips Content-Type so fetch sets the
      // multipart boundary itself.
      const res = await api.request<AvatarUploadResponse>('/me/photo', {
        method: 'POST',
        body: fd,
      });
      queryClient.setQueryData<Profile>(['portal-profile'], (prev) =>
        prev ? { ...prev, photoUrl: res.photoUrl } : prev,
      );
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  }

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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Choose profile photo"
                  onChange={(e) => void handleFileChange(e)}
                />
                <button
                  type="button"
                  className="sk-btn"
                  style={{ marginTop: 6 }}
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploading ? 'Uploading…' : profile.photoUrl ? 'Change photo' : 'Add photo'}
                </button>
              </div>
            </div>
            {uploadError && <p className="sk-state err">{uploadError}</p>}
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
