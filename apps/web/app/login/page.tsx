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

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

export default function TenantLoginPage() {
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  async function onSubmit(values: FormValues) {
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', values);
      setTokens({ ...res, audience: 'school' });
      toast.success('Welcome back');
      router.replace('/app');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>{host?.split(':')[0]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="email" required>Email</Label>
              <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
              {form.formState.errors.email && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password" required>Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
              {form.formState.errors.password && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.password.message}</p>}
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
