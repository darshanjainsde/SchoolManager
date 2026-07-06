'use client';
import { useRouter } from 'next/navigation';
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
import { useHost } from '@/components/use-host';

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string().min(8),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'New password must be different',
  });
type FormValues = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const router = useRouter();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const clear = useAuthStore((s) => s.clear);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: FormValues) {
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('Password changed — please sign in again');
      clear();
      router.replace('/login');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header><h1 className="text-2xl font-semibold text-slate-900">Change password</h1></header>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Update your password</CardTitle>
          <CardDescription>You&apos;ll be signed out of all devices and asked to sign in again.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="currentPassword" required>Current password</Label>
              <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
              {form.formState.errors.currentPassword && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.currentPassword.message}</p>}
            </div>
            <div>
              <Label htmlFor="newPassword" required>New password</Label>
              <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
              {form.formState.errors.newPassword && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.newPassword.message}</p>}
            </div>
            <div>
              <Label htmlFor="confirmPassword" required>Confirm new password</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
              {form.formState.errors.confirmPassword && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.confirmPassword.message}</p>}
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
