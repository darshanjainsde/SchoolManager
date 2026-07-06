'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Me { userId: string; schoolId: string; role: string }

export default function MyProfilePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [me, setMe] = useState<Me | undefined>();
  useEffect(() => { if (host) api.get<Me>('/auth/me').then(setMe).catch(() => undefined); }, [host, api]);

  return (
    <div className="flex flex-col gap-6">
      <header><h1 className="text-2xl font-semibold text-slate-900">Profile</h1></header>
      <Card>
        <CardHeader><CardTitle>Account</CardTitle><CardDescription>What we know about you.</CardDescription></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div><span className="text-slate-500">User ID:</span> <code className="font-mono">{me?.userId ?? '—'}</code></div>
          <div><span className="text-slate-500">Role:</span> {me?.role ?? '—'}</div>
          <div><span className="text-slate-500">School:</span> <code className="font-mono">{me?.schoolId?.slice(0, 8) ?? '—'}…</code></div>
          <div><span className="text-slate-500">Host:</span> {host}</div>
        </CardContent>
      </Card>
      <Link href="/account/password" className="text-sm text-indigo-600 hover:underline">
        Change password →
      </Link>
    </div>
  );
}
