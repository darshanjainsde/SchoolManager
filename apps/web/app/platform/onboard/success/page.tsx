'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function OnboardSuccessPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
      <OnboardSuccessInner />
    </Suspense>
  );
}

function OnboardSuccessInner() {
  const params = useSearchParams();
  const schoolId = params.get('schoolId') ?? '';
  const slug = params.get('slug') ?? '';
  const token = params.get('token') ?? '';
  const email = params.get('email') ?? '';
  const tenantHost = `http://${slug}.localhost:3000`;
  const inviteUrl = `${tenantHost}/accept-invite?token=${token}&u=…&email=${encodeURIComponent(email)}`;
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>School provisioned ✓</CardTitle>
          <CardDescription>
            We&apos;ve queued the heavy work (CSV import, invite email, domain verify). It usually completes within a minute.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div>
            <div className="text-slate-500">Tenant portal</div>
            <Link href={tenantHost} className="font-mono text-blue-600 underline">{tenantHost}</Link>
          </div>
          <div>
            <div className="text-slate-500">Admin invite link</div>
            <code className="block break-all rounded bg-slate-100 p-2 font-mono text-xs">{inviteUrl}</code>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                navigator.clipboard?.writeText(inviteUrl);
                toast.success('Copied');
              }}
            >
              Copy
            </Button>
          </div>
          <div>
            <div className="text-slate-500">School ID</div>
            <code className="font-mono text-xs">{schoolId}</code>
          </div>
        </CardContent>
        <div className="flex justify-end gap-2 border-t border-slate-100 p-6">
          <Link href={`/platform/schools/${schoolId}`}>
            <Button variant="outline">Open school detail</Button>
          </Link>
          <Link href="/platform/schools">
            <Button>Back to schools</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
