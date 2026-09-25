'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UsersRound } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { useHost } from '@/components/use-host';
import { homeForRole } from '@/lib/role-routes';

/**
 * SWITCH PROFILE (design §4–§5). Shown only when this login's phone number
 * opens more than one profile. Same host → one tap swaps the session (the
 * server checks the shared number again). Another school → a link to that
 * school's own door; a browser session is bound to its host.
 */
interface Profile { userId: string; kind: string; role: string; label: string; sub: string; schoolName: string; host: string }

export function SwitchProfile({ variant = 'nav', onDone }: { variant?: 'nav' | 'bar'; onDone?: () => void }) {
  const host = useHost();
  const router = useRouter();
  const qc = useQueryClient();
  const api = useApi({ audience: 'school', hostHeader: host });
  const setTokens = useAuthStore((s) => s.setTokens);
  const setMe = useAuthStore((s) => s.setMe);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ['profiles', host],
    enabled: !!host,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => api.get<{ current: string; profiles: Profile[] }>('/auth/profiles'),
  });
  const here = (host ?? '').split(':')[0];
  const others = (q.data?.profiles ?? []).filter((p) => p.userId !== q.data?.current);
  if (others.length === 0) return null;

  async function pick(p: Profile) {
    if (p.host !== here) { window.location.assign(`https://${p.host}/login`); return; }
    setBusy(p.userId);
    try {
      const r = await api.post<{ accessToken: string; refreshToken?: string }>('/auth/switch', { userId: p.userId });
      setTokens({ ...r, audience: 'school' });
      qc.clear();
      const me = await api.get<{ userId: string; schoolId?: string; role?: string; staffRole?: string | null }>('/auth/me');
      setMe(me);
      toast.success(`Now open as ${p.label}.`);
      onDone?.();
      router.replace(homeForRole(me.role, me.staffRole));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`sk-swprof${variant === 'bar' ? ' sk-switch-bar' : ''}`} data-testid="switch-profile">
      <button type="button" className={variant === 'bar' ? 'sk-signout' : 'sk-nav'} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((o) => !o)} style={variant === 'nav' ? { width: '100%', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' } : undefined}>
        <UsersRound className={variant === 'bar' ? 'h-3.5 w-3.5' : 'ic'} aria-hidden="true" />
        <span className={variant === 'bar' ? 'hidden sm:inline' : undefined}>Switch profile</span>
      </button>
      {open ? (
        <ul className="sk-switch-list" role="listbox" aria-label="Open as">
          {others.map((p) => (
            <li key={p.userId}>
              <button type="button" role="option" aria-selected="false" className="sk-switch-item" disabled={busy !== null} onClick={() => void pick(p)}>
                <span className="sk-switch-av" aria-hidden="true">{p.label.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}</span>
                <span className="sk-switch-t"><b>{busy === p.userId ? 'Opening…' : p.label}</b><small>{p.sub}{p.host !== here ? ` · ${p.schoolName} (opens that school)` : ''}</small></span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
