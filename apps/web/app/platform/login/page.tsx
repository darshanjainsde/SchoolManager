'use client';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password required'),
  totp: z.string().regex(/^\d{6}$/, '6-digit code'),
});
type FormValues = z.infer<typeof schema>;

export default function PlatformLoginPage() {
  const router = useRouter();
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });
  const setTokens = useAuthStore((s) => s.setTokens);
  const [pending, setPending] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '', totp: '' } });

  async function onSubmit(values: FormValues) {
    setPending(true);
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string }>('/owner/auth/login', values);
      setTokens({ ...res, audience: 'platform' });
      toast.success('Welcome back');
      router.replace('/platform');
    } catch (err) {
      const e = err as ApiError;
      toast.error(e.message || 'Login failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Platform owner login</CardTitle>
          <CardDescription>Restricted to the owner host. Password + TOTP required.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="email" required>Email</Label>
              <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
              {form.formState.errors.email && (
                <p className="mt-1 text-xs text-rose-600">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="password" required>Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
              {form.formState.errors.password && (
                <p className="mt-1 text-xs text-rose-600">{form.formState.errors.password.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="totp" required hint="6-digit code from your authenticator app">TOTP</Label>
              <Input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...form.register('totp')} />
              {form.formState.errors.totp && (
                <p className="mt-1 text-xs text-rose-600">{form.formState.errors.totp.message}</p>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
