'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { homeForRole } from '@/lib/role-routes';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

// The identifier is an email for staff and an admission no. OR email for
// students, so it can't be a blanket z.string().email().
const schema = z.object({
  identifier: z.string().min(1, 'Required'),
  password: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

type RoleTab = 'STUDENT' | 'TEACHER' | 'ADMIN';

/**
 * The slider is a convenience only — it picks the copy/keyboard, never the
 * destination. Routing after login always follows the role the API reports.
 */
const ROLE_TABS: { value: RoleTab; label: string; idLabel: string; submit: string; hint: string }[] = [
  {
    value: 'STUDENT',
    label: 'Student',
    idLabel: 'Student code, admission no. or email',
    submit: 'Sign in to student portal',
    hint: 'Use the student code on your school letter (like RAF-00042), the admission number, or the email on the record.',
  },
  {
    value: 'TEACHER',
    label: 'Teacher',
    idLabel: 'Email',
    submit: 'Sign in to teacher portal',
    hint: 'Teachers use the email address the school invited them with.',
  },
  {
    value: 'ADMIN',
    label: 'Admin',
    idLabel: 'Email',
    submit: 'Sign in to admin',
    hint: 'School admins and office staff manage the school here.',
  },
];

export default function TenantLoginPage() {
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const [role, setRole] = useState<RoleTab>('STUDENT');
  const tab = ROLE_TABS.find((t) => t.value === role) ?? ROLE_TABS[0];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  });

  const setMe = useAuthStore((s) => s.setMe);
  const [exchangingImp, setExchangingImp] = useState(false);

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
      const me = await api.get<{ userId: string; schoolId?: string; role?: string }>('/auth/me');

      setMe(me);
      toast.success('Welcome back');
      // Never trust the slider — the API's role decides where the user lands.
      router.replace(homeForRole(me.role));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <SckoolsLogo animate size={40} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>{exchangingImp ? 'Opening owner view…' : host?.split(':')[0]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div
              role="radiogroup"
              aria-label="I am a"
              className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
            >
              {ROLE_TABS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={role === t.value}
                  onClick={() => setRole(t.value)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    role === t.value
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div>
              <Label htmlFor="identifier" required>{tab.idLabel}</Label>
              <Input
                id="identifier"
                type={role === 'STUDENT' ? 'text' : 'email'}
                autoComplete="username"
                {...form.register('identifier')}
              />
              {form.formState.errors.identifier && (
                <p className="mt-1 text-xs text-rose-600">{form.formState.errors.identifier.message}</p>
              )}
              <p className="mt-1 text-xs text-slate-400">{tab.hint}</p>
            </div>
            <div>
              <Label htmlFor="password" required>Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
              {form.formState.errors.password && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.password.message}</p>}
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in…' : tab.submit}
            </Button>
            <a href="/forgot-password" className="text-center text-sm text-slate-500 hover:text-teal-700 transition">
              Forgot password?
            </a>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
