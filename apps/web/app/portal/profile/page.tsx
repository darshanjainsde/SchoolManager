'use client';
import { useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Hash, ListOrdered } from 'lucide-react';
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
  // True only for a photo chosen in THIS session — see `sk-pinin` on the
  // avatar below. A photo already on file must not re-drop on every visit.
  const [justPasted, setJustPasted] = useState(false);

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
      setJustPasted(true);
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
        <p>Your school record, and the photo that goes with it everywhere.</p>
      </header>

      {isLoading && <p className="sk-state">Loading profile…</p>}
      {error && <p className="sk-state err">{(error as Error).message}</p>}

      {profile && (
        <div className="sk-card max-w-md">
          <div className="sk-card-b">
            {/* ── The head ──────────────────────────────────────────────────
                Centred, with the photo the largest thing on it: on this page
                the photo IS the content — it is what appears on the class
                roster, in the register and on every message thread, so it is
                shown at the size it deserves rather than as a list bullet. */}
            <div className="sk-pfhead">
              <div
                // sk-pinin: a photo chosen just now DROPS onto the page and
                // settles square, the way something is pasted into an album.
                // The gesture says "that one landed" — a silently swapped
                // image looks identical to one that never uploaded.
                className={justPasted ? 'sk-bigav sk-pinin sk-in' : 'sk-bigav'}
              >
                {profile.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.photoUrl} alt={`${profile.firstName} ${profile.lastName}`} />
                ) : (
                  <span aria-hidden="true">{initials(profile.firstName, profile.lastName)}</span>
                )}
              </div>

              {/* Still a heading, as it was before the redesign: this is the
                  name of the record the card is about, and a screen reader
                  navigating by heading has to be able to land on it. */}
              <h2 className="sk-pfname">
                {profile.firstName} {profile.lastName}
              </h2>
              {/* No class line here on purpose: the ruled record below states
                  it once, as a field. Saying it twice on one small card makes
                  the second one read as a different fact. */}

              {/* The student code is the one string on this page that gets
                  said out loud — at the office, on the phone, at the login
                  box. Mono and letter-spaced so a 0 is never read back as an
                  O, and set as a chip so it is findable without reading. */}
              {profile.code && (
                <div className="sk-pfcode">
                  <span className="sr-only">Student code </span>
                  {profile.code}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Choose profile photo"
                onChange={(e) => void handleFileChange(e)}
              />
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="sk-btn sk-press"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploading ? 'Uploading…' : profile.photoUrl ? 'Change photo' : 'Add photo'}
                </button>
              </div>
              {uploadError && <p className="sk-state err">{uploadError}</p>}
            </div>

            {/* ── The ruled rows ────────────────────────────────────────────
                A form filled in on paper: an icon tile, the label, the value,
                a rule between each. The figures take the register's face
                because they are numbers that get copied out. */}
            <div style={{ marginTop: 14 }}>
              <div className="sk-pfrow">
                <span className="ic" aria-hidden="true">
                  <Hash className="h-4 w-4" />
                </span>
                <span className="sk-lab">Admission no.</span>
                <span className="v mono">{profile.admissionNo}</span>
              </div>
              <div className="sk-pfrow">
                <span className="ic" aria-hidden="true">
                  <ListOrdered className="h-4 w-4" />
                </span>
                <span className="sk-lab">Roll no.</span>
                <span className="v mono">
                  {profile.rollNo ?? <span className="sk-muted">Not on file</span>}
                </span>
              </div>
              <div className="sk-pfrow">
                <span className="ic" aria-hidden="true">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <span className="sk-lab">Class</span>
                <span className="v">
                  {profile.className ?? <span className="sk-muted">Not on file</span>}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
