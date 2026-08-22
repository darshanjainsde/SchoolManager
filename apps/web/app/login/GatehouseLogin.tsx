'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { homeForRole } from '@/lib/role-routes';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ROLE_TABS, type LoginTheme, type RoleTab } from './gatehouse-theme';

// The identifier is an email for staff and a student code / admission no. OR
// email for students, so it can't be a blanket z.string().email().
const schema = z.object({
  identifier: z.string().min(1, 'Required'),
  password: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

const LAST_ROLE_KEY = 'sk-login-role';

/** Friendly destination line for the gate-open moment, keyed by the API role. */
const DESTINATION: Record<string, string> = {
  STUDENT: 'Opening the student portal',
  TEACHER: 'Opening the staff room',
  STAFF: 'Opening the staff area',
  SCHOOL_ADMIN: 'Opening the admin console',
};

/**
 * School-crest mark: the uploaded logo when the school has one, otherwise a
 * generated shield with the school's initial (branded schools without a logo),
 * otherwise the Sckools Tassel-S (unbranded fallback). Deterministic — safe to
 * server-render.
 */
export function Crest({ theme, size = 44 }: { theme: LoginTheme; size?: number }) {
  // A school logo that 404s (moved bucket, dead URL) must degrade to the
  // generated shield, never to a broken-image glyph on the identity panel.
  const [logoFailed, setLogoFailed] = useState(false);
  if (theme.logoUrl && !logoFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={theme.logoUrl}
        alt=""
        width={size}
        height={size}
        className="gh-crest-img"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  if (!theme.branded) return <SckoolsLogo variant="symbol" theme="dark" size={size} />;
  const initial = (theme.schoolName.trim()[0] ?? 'S').toUpperCase();
  return (
    <svg width={size} height={Math.round(size * 1.12)} viewBox="0 0 40 45" aria-hidden="true">
      <path d="M20 1 L38 7 V22 C38 33 30 41 20 44 C10 41 2 33 2 22 V7 Z" fill="rgba(255,255,255,.92)" />
      <path
        d="M20 5 L34 9.6 V22 C34 30.5 28 37 20 39.8 C12 37 6 30.5 6 22 V9.6 Z"
        fill="none"
        stroke={theme.primary}
        strokeWidth="1.3"
      />
      <text x="20" y="27.5" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="bold" fontSize="17" fill={theme.primary}>
        {initial}
      </text>
    </svg>
  );
}

type SubmitPhase = 'idle' | 'open';

export default function GatehouseLogin({ theme }: { theme: LoginTheme }) {
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setMe = useAuthStore((s) => s.setMe);
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const [role, setRole] = useState<RoleTab>('STUDENT');
  const tab = ROLE_TABS.find((t) => t.value === role) ?? ROLE_TABS[0];

  // Last-used role, restored after hydration only — never during render.
  useEffect(() => {
    const saved = localStorage.getItem(LAST_ROLE_KEY);
    if (saved && ROLE_TABS.some((t) => t.value === saved)) setRole(saved as RoleTab);
  }, []);
  function pickRole(next: RoleTab) {
    setRole(next);
    try {
      localStorage.setItem(LAST_ROLE_KEY, next);
    } catch {
      // Private-mode storage failures must never break role selection.
    }
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  });

  const [exchangingImp, setExchangingImp] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const [destination, setDestination] = useState('Opening your portal');
  const [shaking, setShaking] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
  }, []);

  // Owner impersonation handoff: /login?imp=<token> exchanges the single-use
  // token for a short-lived admin session (no refresh token — it hard-expires).
  useEffect(() => {
    if (!host) return;
    const imp = new URLSearchParams(window.location.search).get('imp');
    if (!imp) return;
    setExchangingImp(true);
    api
      .post<{ accessToken: string; expiresIn: number }>('/auth/impersonate', { token: imp })
      .then((res) => {
        setTokens({ accessToken: res.accessToken, audience: 'school' });
        toast.success('Owner view active — session ends automatically in 15 minutes');
        router.replace('/app');
      })
      .catch(() => {
        setExchangingImp(false);
        toast.error('This impersonation link is invalid or has expired — mint a new one from the owner console.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  async function onSubmit(values: FormValues) {
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
        identifier: values.identifier.trim(),
        password: values.password,
      });
      setTokens({ ...res, audience: 'school' });
      const me = await api.get<{ userId: string; schoolId?: string; role?: string; staffRole?: string | null }>(
        '/auth/me',
      );

      setMe(me);
      // Never trust the selector — the API's role decides where the user
      // lands. The gate-open line reads the API's answer for the same reason.
      const target = homeForRole(me.role, me.staffRole);
      setDestination(target === '/library' ? 'Opening the library' : (DESTINATION[me.role ?? ''] ?? 'Opening your portal'));
      setPhase('open');
      // Let the flood play one beat; routing happens under it.
      setTimeout(() => router.replace(target), 900);
    } catch (e) {
      setShaking(true);
      shakeTimer.current = setTimeout(() => setShaking(false), 500);
      toast.error((e as Error).message);
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <div
      className="gh-stage"
      style={
        {
          '--gh-p': theme.primary,
          '--gh-s': theme.secondary,
          '--gh-font': theme.fontStack,
        } as React.CSSProperties
      }
    >
      {/* Living background: drifting color fields, slow rings, rising motes.
          The lattice layer is painted by .gh-stage::before. */}
      <span className="gh-blob gh-b1" aria-hidden="true" />
      <span className="gh-blob gh-b2" aria-hidden="true" />
      <span className="gh-ring gh-r1" aria-hidden="true" />
      <span className="gh-ring gh-r2" aria-hidden="true" />
      <span className="gh-mote" style={{ left: '10%', top: '72%', animationDuration: '9s' }} aria-hidden="true" />
      <span className="gh-mote gh-mote-s" style={{ left: '22%', top: '88%', animationDuration: '12s', animationDelay: '2.5s' }} aria-hidden="true" />
      <span className="gh-mote" style={{ left: '48%', top: '94%', animationDuration: '10s', animationDelay: '5s' }} aria-hidden="true" />
      <span className="gh-mote gh-mote-s" style={{ left: '71%', top: '85%', animationDuration: '13s', animationDelay: '1.2s' }} aria-hidden="true" />
      <span className="gh-mote" style={{ left: '86%', top: '70%', animationDuration: '11s', animationDelay: '3.8s' }} aria-hidden="true" />

      <div className={`gh-shell${shaking ? ' gh-shake' : ''}`}>
        {/* ── Identity panel: the school half ── */}
        <div className="gh-left">
          <div className="gh-left-top">
            <span className="gh-crest">
              <Crest theme={theme} />
            </span>
            <h1 className="gh-name" style={{ fontFamily: 'var(--gh-font)' }}>
              {theme.schoolName}
            </h1>
            <p className="gh-tagline">{theme.tagline}</p>
            <div className="gh-plate" aria-live="polite">
              <span key={role} className="gh-plate-text">
                {tab.plate}
              </span>
            </div>
          </div>
          <span className="gh-watermark" aria-hidden="true">
            <Crest theme={theme} size={150} />
          </span>
          <p className="gh-foot">
            You&rsquo;re signing in to the school&rsquo;s own system · {theme.hostname}
          </p>
        </div>

        {/* ── Form panel ── */}
        <div className="gh-right">
          <form className="gh-form" onSubmit={form.handleSubmit(onSubmit)}>
            <p className="gh-label gh-signin-as">Sign in as</p>
            <div className="gh-roles" role="radiogroup" aria-label="Sign in as">
              {ROLE_TABS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={role === t.value}
                  className="gh-role"
                  onClick={() => pickRole(t.value)}
                >
                  <span className="gh-role-copy">
                    <b>{t.label}</b>
                    <small>{t.sub}</small>
                  </span>
                </button>
              ))}
            </div>

            <div key={role} className="gh-swap">
              <div>
                <label className="gh-label" htmlFor="identifier">
                  {tab.idLabel}
                </label>
                <input
                  id="identifier"
                  className="gh-input"
                  type={tab.inputType}
                  autoComplete="username"
                  {...form.register('identifier')}
                />
                {form.formState.errors.identifier && (
                  <p className="gh-error">{form.formState.errors.identifier.message}</p>
                )}
                <p className="gh-hint">{tab.hint}</p>
              </div>
              <div>
                <label className="gh-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  className="gh-input"
                  type="password"
                  autoComplete="current-password"
                  {...form.register('password')}
                />
                {form.formState.errors.password && (
                  <p className="gh-error">{form.formState.errors.password.message}</p>
                )}
              </div>
              <button type="submit" className={`gh-btn${busy ? ' gh-busy' : ''}`} disabled={busy || phase === 'open'}>
                {busy ? 'Opening the gates…' : tab.submit}
              </button>
            </div>
            <a href="/forgot-password" className="gh-forgot">
              Forgot password?
            </a>
            {theme.branded && (
              <p className="gh-powered">
                Powered by <b>Sckools</b>
              </p>
            )}
          </form>
        </div>

        {/* ── Gate-open moment: plays only on a successful token + /auth/me ── */}
        <div className={`gh-gate${phase === 'open' || exchangingImp ? ' gh-gate-on' : ''}`} aria-hidden={phase !== 'open' && !exchangingImp}>
          <div className="gh-gate-inner">
            <span className="gh-gate-pulse" aria-hidden="true" />
            <Crest theme={theme} size={46} />
            <p className="gh-gate-title" style={{ fontFamily: 'var(--gh-font)' }}>
              {exchangingImp ? 'Opening owner view…' : 'Welcome back'}
            </p>
            {!exchangingImp && (
              <p className="gh-gate-sub">
                {destination} · {theme.schoolName}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
