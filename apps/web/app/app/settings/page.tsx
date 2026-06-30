'use client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Phase 3 stub — branding edits live in the owner portal.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Coming next</CardTitle>
          <CardDescription>School-side settings (term dates, grading defaults, locale) ship with the rest of Phase 3 polish.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">
          For now, branding edits are owner-portal only. Open the owner portal at <code className="font-mono">owner.localhost:3000/platform</code>.
        </CardContent>
      </Card>
    </div>
  );
}
