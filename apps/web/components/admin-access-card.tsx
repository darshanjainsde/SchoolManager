'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

interface AdminRow {
  userId: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

export function AdminAccessCard({ schoolId }: { schoolId: string }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const [revealed, setRevealed] = useState<{ userId: string; password: string } | null>(null);

  const { data: admins, isLoading, error } = useQuery({
    queryKey: ['owner-school-admins', schoolId],
    queryFn: () => api.get<AdminRow[]>(`/owner/schools/${schoolId}/admins`),
    enabled: !!refreshToken,
  });

  const reset = useMutation({
    mutationFn: (userId: string) =>
      api.post<{ password: string }>(`/owner/schools/${schoolId}/admins/${userId}/reset-password`),
    onSuccess: (res, userId) => {
      setRevealed({ userId, password: res.password });
      toast.success('Password reset — copy it now, it is shown once');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin access</CardTitle>
        <CardDescription>Login email and password reset for this school&apos;s administrators.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {error && <p className="text-sm text-rose-600">{(error as Error).message}</p>}
        {admins && admins.length === 0 && <p className="text-sm text-slate-500">No admins found.</p>}
        <ul className="divide-y divide-slate-100">
          {admins?.map((a) => {
            const locked = a.lockedUntil ? new Date(a.lockedUntil) > new Date() : false;
            const resetting = reset.isPending && reset.variables === a.userId;
            return (
              <li key={a.userId} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="font-mono text-sm text-slate-800">{a.email}</span>
                    <span className="text-xs text-slate-400">
                      Last login: {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : 'never'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!a.isActive && <Badge tone="neutral">inactive</Badge>}
                    {locked && <Badge tone="warning">locked</Badge>}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reset.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Reset password for ${a.email}? Their current password stops working immediately.`,
                          )
                        ) {
                          reset.mutate(a.userId);
                        }
                      }}
                    >
                      {resetting ? 'Resetting…' : 'Reset password'}
                    </Button>
                  </div>
                </div>
                {revealed?.userId === a.userId && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-amber-800">New password — shown once</span>
                      <code className="font-mono text-sm text-amber-900">{revealed.password}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard?.writeText(revealed.password);
                          toast.success('Copied');
                        }}
                      >
                        Copy
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRevealed(null)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
