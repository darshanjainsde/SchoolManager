'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

const schema = z
  .object({
    password: z.string().min(8).regex(/[A-Za-z]/, 'needs a letter').regex(/[0-9]/, 'needs a digit'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords must match' });

type FormValues = z.infer<typeof schema>;

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>}>
      <AcceptInviteInner />
    </Suspense>
  );
}

function AcceptInviteInner() {
  const params = useSearchParams();
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [host, setHost] = useState<string | undefined>();

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  const api = useApi({ audience: 'school', hostHeader: host });

  const userId = params.get('u') ?? '';
  const token = params.get('token') ?? '';
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  async function onSubmit(values: FormValues) {
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string }>('/auth/accept-invite', {
        userId,
        inviteToken: token,
        password: values.password,
      });
      setTokens({ ...res, audience: 'school' });
      toast.success('Password set. Welcome aboard.');
      router.replace('/app');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!userId || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid invite link</CardTitle>
            <CardDescription>Missing token or user id. Ask your platform admin to resend the invite.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>One-time link. After this, sign in normally.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="password" required>New password</Label>
              <Input id="password" type="password" {...form.register('password')} />
              {form.formState.errors.password && (
                <p className="mt-1 text-xs text-rose-600">{form.formState.errors.password.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirm" required>Confirm</Label>
              <Input id="confirm" type="password" {...form.register('confirm')} />
              {form.formState.errors.confirm && (
                <p className="mt-1 text-xs text-rose-600">{form.formState.errors.confirm.message}</p>
              )}
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Activate account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
