'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { useWizardStore, type CsvUser } from '@/lib/wizard-store';
import { cn } from '@/lib/cn';

const STEPS = [
  'Basics',
  'Branding',
  'Contact',
  'Plan',
  'Domain',
  'CSV import',
  'Review',
];

export default function OnboardPage() {
  const w = useWizardStore();
  const router = useRouter();
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });

  const submit = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: w.name,
        slug: w.slug.toLowerCase(),
        adminEmail: w.adminEmail,
        adminFirstName: w.adminFirstName,
        adminLastName: w.adminLastName,
        subscriptionPlan: w.subscriptionPlan,
      };
      if (w.logoUrl) payload.logoUrl = w.logoUrl;
      if (w.faviconUrl) payload.faviconUrl = w.faviconUrl;
      if (w.brandPrimary) payload.brandColors = { primary: w.brandPrimary, accent: w.brandAccent };
      if (w.aboutPage) payload.aboutPage = w.aboutPage;
      if (w.addressLine1 || w.city) {
        payload.address = {
          line1: w.addressLine1,
          city: w.city,
          region: w.region,
          postalCode: w.postalCode,
          country: w.country,
          lat: w.geoLat,
          lng: w.geoLng,
        };
      }
      if (w.phone) payload.phone = w.phone;
      if (w.email) payload.email = w.email;
      if (w.timezone) payload.timezone = w.timezone;
      if (w.currency) payload.currency = w.currency;
      if (w.domainHostname && w.domainType) {
        payload.customDomain = { hostname: w.domainHostname, type: w.domainType };
      }
      if (w.initialTeachers.length) payload.initialTeachers = w.initialTeachers;
      if (w.initialStudents.length) payload.initialStudents = w.initialStudents;
      return api.post<{ schoolId: string; slug: string; inviteToken: string; adminEmail: string }>(
        '/platform/schools',
        payload,
      );
    },
    onSuccess: (data) => {
      toast.success(`Provisioned "${data.slug}" — invite emailed.`);
      w.reset();
      router.push(`/platform/onboard/success?schoolId=${data.schoolId}&slug=${data.slug}&token=${data.inviteToken}&email=${encodeURIComponent(data.adminEmail)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Onboard a school</h1>
          <p className="text-sm text-slate-500">Step {w.step} of {STEPS.length}: {STEPS[w.step - 1]}</p>
        </div>
        <Button variant="ghost" onClick={() => w.reset()}>Start over</Button>
      </header>

      <Stepper step={w.step} />

      <Card>
        <CardContent className="p-6">
          {w.step === 1 && <BasicsStep />}
          {w.step === 2 && <BrandingStep />}
          {w.step === 3 && <ContactStep />}
          {w.step === 4 && <PlanStep />}
          {w.step === 5 && <DomainStep />}
          {w.step === 6 && <CsvStep />}
          {w.step === 7 && <ReviewStep />}
        </CardContent>
        <div className="flex items-center justify-between border-t border-slate-100 p-6">
          <Button variant="ghost" disabled={w.step === 1} onClick={w.prev}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          {w.step < 7 ? (
            <Button onClick={w.next} disabled={!canAdvance(w)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => submit.mutate()} disabled={submit.isPending || !canSubmit(w)}>
              {submit.isPending ? 'Provisioning…' : 'Provision school'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold',
                done ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-slate-900 text-slate-900' : 'border-slate-300 text-slate-400',
              )}
            >
              {done ? <Check className="h-3 w-3" /> : n}
            </span>
            <span className={cn(active ? 'text-slate-900' : 'text-slate-500')}>{label}</span>
            {n < STEPS.length && <span className="text-slate-300">/</span>}
          </li>
        );
      })}
    </ol>
  );
}

function canAdvance(w: ReturnType<typeof useWizardStore.getState>): boolean {
  switch (w.step) {
    case 1:
      return Boolean(
        w.name.length >= 2 &&
          /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(w.slug) &&
          /\S+@\S+\.\S+/.test(w.adminEmail) &&
          w.adminFirstName &&
          w.adminLastName,
      );
    case 4:
      return Boolean(w.subscriptionPlan);
    case 5:
      if (!w.domainHostname && !w.domainType) return true; // optional step
      return Boolean(w.domainHostname && /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(w.domainHostname) && w.domainType);
    default:
      return true;
  }
}

function canSubmit(w: ReturnType<typeof useWizardStore.getState>): boolean {
  return canAdvance({ ...w, step: 1 });
}

// ── steps ─────────────────────────────────────────────────────────────────

function BasicsStep() {
  const w = useWizardStore();
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });
  const [debouncedSlug, setDebouncedSlug] = useState(w.slug);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSlug(w.slug), 300);
    return () => clearTimeout(id);
  }, [w.slug]);

  const slugCheck = useQuery({
    queryKey: ['slug-availability', debouncedSlug],
    enabled: !!debouncedSlug && /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(debouncedSlug),
    queryFn: () =>
      api.get<{ available: boolean; suggestion?: string | null }>(
        `/platform/schools/slug-availability?slug=${encodeURIComponent(debouncedSlug)}`,
      ),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="name" required>School name</Label>
        <Input id="name" value={w.name} onChange={(e) => w.patch({ name: e.target.value })} placeholder="Cedar Grove Academy" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="slug" required hint="Lowercase letters, digits, dashes. Becomes <slug>.skoolos.app">URL slug</Label>
        <Input
          id="slug"
          value={w.slug}
          onChange={(e) => w.patch({ slug: e.target.value.toLowerCase() })}
          placeholder="cedar-grove"
        />
        {slugCheck.data && (
          <p className={cn('mt-1 text-xs', slugCheck.data.available ? 'text-emerald-600' : 'text-rose-600')}>
            {slugCheck.data.available
              ? `Available — your portal will live at ${w.slug}.skoolos.app`
              : slugCheck.data.suggestion
                ? `Taken — try "${slugCheck.data.suggestion}"`
                : 'Taken — pick another'}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="adminFirstName" required>Admin first name</Label>
        <Input id="adminFirstName" value={w.adminFirstName} onChange={(e) => w.patch({ adminFirstName: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="adminLastName" required>Admin last name</Label>
        <Input id="adminLastName" value={w.adminLastName} onChange={(e) => w.patch({ adminLastName: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="adminEmail" required>Admin email</Label>
        <Input id="adminEmail" type="email" value={w.adminEmail} onChange={(e) => w.patch({ adminEmail: e.target.value })} />
      </div>
    </div>
  );
}

function BrandingStep() {
  const w = useWizardStore();
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });
  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null);

  async function upload(kind: 'logo' | 'favicon', file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large — 2MB cap');
      return;
    }
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.request<{ url: string }>(`/platform/uploads/${kind}`, { method: 'POST', body: fd });
      w.patch(kind === 'logo' ? { logoUrl: res.url } : { faviconUrl: res.url });
      toast.success(`${kind} uploaded`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Logo</Label>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={(e) => e.target.files?.[0] && upload('logo', e.target.files[0])}
          />
          {uploading === 'logo' && <span className="text-xs text-slate-500">Uploading…</span>}
          {w.logoUrl && <span className="text-xs text-emerald-600">Uploaded ✓</span>}
        </div>
      </div>
      <div>
        <Label>Favicon</Label>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/png,image/jpeg,image/x-icon"
            onChange={(e) => e.target.files?.[0] && upload('favicon', e.target.files[0])}
          />
          {uploading === 'favicon' && <span className="text-xs text-slate-500">Uploading…</span>}
          {w.faviconUrl && <span className="text-xs text-emerald-600">Uploaded ✓</span>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="brandPrimary" hint="Hex (e.g. #0ea5e9)">Brand primary</Label>
          <Input
            id="brandPrimary"
            value={w.brandPrimary ?? ''}
            onChange={(e) => w.patch({ brandPrimary: e.target.value })}
            placeholder="#0ea5e9"
          />
        </div>
        <div>
          <Label htmlFor="brandAccent" hint="Optional secondary colour">Brand accent</Label>
          <Input
            id="brandAccent"
            value={w.brandAccent ?? ''}
            onChange={(e) => w.patch({ brandAccent: e.target.value })}
            placeholder="#0f172a"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="aboutPage" hint="Markdown supported, shown on the school's landing page.">About page</Label>
        <Textarea
          id="aboutPage"
          rows={6}
          value={w.aboutPage ?? ''}
          onChange={(e) => w.patch({ aboutPage: e.target.value })}
          placeholder="# Welcome to Cedar Grove Academy…"
        />
      </div>
    </div>
  );
}

function ContactStep() {
  const w = useWizardStore();
  const timezones = useMemo(() => {
    // Intl.supportedValuesOf is widely available in modern runtimes.
    try {
      return (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
    } catch {
      return ['UTC'];
    }
  }, []);
  const currencies = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'BRL', 'ZAR'];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="addressLine1">Address line 1</Label>
        <Input id="addressLine1" value={w.addressLine1 ?? ''} onChange={(e) => w.patch({ addressLine1: e.target.value })} />
      </div>
      <div><Label htmlFor="city">City</Label>
        <Input id="city" value={w.city ?? ''} onChange={(e) => w.patch({ city: e.target.value })} />
      </div>
      <div><Label htmlFor="region">Region / state</Label>
        <Input id="region" value={w.region ?? ''} onChange={(e) => w.patch({ region: e.target.value })} />
      </div>
      <div><Label htmlFor="postalCode">Postal code</Label>
        <Input id="postalCode" value={w.postalCode ?? ''} onChange={(e) => w.patch({ postalCode: e.target.value })} />
      </div>
      <div><Label htmlFor="country">Country (ISO-2)</Label>
        <Input id="country" maxLength={2} value={w.country ?? ''} onChange={(e) => w.patch({ country: e.target.value.toUpperCase() })} />
      </div>
      <div><Label htmlFor="phone">Phone</Label>
        <Input id="phone" value={w.phone ?? ''} onChange={(e) => w.patch({ phone: e.target.value })} />
      </div>
      <div><Label htmlFor="email">Contact email</Label>
        <Input id="email" type="email" value={w.email ?? ''} onChange={(e) => w.patch({ email: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="timezone">Timezone</Label>
        <Select id="timezone" value={w.timezone ?? 'UTC'} onChange={(e) => w.patch({ timezone: e.target.value })}>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="currency">Currency</Label>
        <Select id="currency" value={w.currency ?? 'USD'} onChange={(e) => w.patch({ currency: e.target.value })}>
          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="geoLat" hint="Optional — used in maps later.">Latitude</Label>
        <Input id="geoLat" inputMode="decimal" value={w.geoLat ?? ''} onChange={(e) => w.patch({ geoLat: e.target.value ? Number(e.target.value) : undefined })} />
      </div>
      <div>
        <Label htmlFor="geoLng">Longitude</Label>
        <Input id="geoLng" inputMode="decimal" value={w.geoLng ?? ''} onChange={(e) => w.patch({ geoLng: e.target.value ? Number(e.target.value) : undefined })} />
      </div>
    </div>
  );
}

function PlanStep() {
  const w = useWizardStore();
  const plans: Array<{ key: typeof w.subscriptionPlan; label: string; description: string }> = [
    { key: 'TRIAL', label: 'Trial', description: '14-day free, no card.' },
    { key: 'STARTER', label: 'Starter', description: 'Up to 250 students.' },
    { key: 'PRO', label: 'Pro', description: 'Up to 2,000 students + analytics.' },
    { key: 'ENTERPRISE', label: 'Enterprise', description: 'Unlimited + SSO + custom SLAs.' },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {plans.map((p) => {
        const selected = w.subscriptionPlan === p.key;
        return (
          <button
            type="button"
            key={p.key}
            onClick={() => w.patch({ subscriptionPlan: p.key })}
            className={cn(
              'rounded-lg border p-4 text-left transition-all',
              selected ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-200 hover:border-slate-400',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.label}</span>
              {selected && <Badge tone="success">Selected</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-500">{p.description}</p>
          </button>
        );
      })}
    </div>
  );
}

function DomainStep() {
  const w = useWizardStore();
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });

  const dnsPreview = useQuery({
    queryKey: ['preview-dns', w.domainHostname, w.domainType],
    enabled: !!(w.domainHostname && w.domainType && /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(w.domainHostname)),
    queryFn: () =>
      api.post<{
        records: Array<{ kind: string; name: string; value: string; ttl: number; note?: string }>;
      }>('/platform/schools/preview-dns', {
        hostname: w.domainHostname,
        type: w.domainType,
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Optional. You can also skip this and add a domain later from the school&apos;s detail page.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="domainHostname" hint="Example: portal.cedar.edu">Hostname</Label>
          <Input id="domainHostname" value={w.domainHostname ?? ''} onChange={(e) => w.patch({ domainHostname: e.target.value.toLowerCase() })} />
        </div>
        <div>
          <Label htmlFor="domainType">Type</Label>
          <Select
            id="domainType"
            value={w.domainType ?? ''}
            onChange={(e) => w.patch({ domainType: (e.target.value || undefined) as 'APEX' | 'SUBDOMAIN' | undefined })}
          >
            <option value="">—</option>
            <option value="SUBDOMAIN">Subdomain (recommended)</option>
            <option value="APEX">Apex (e.g. school.edu)</option>
          </Select>
        </div>
      </div>
      {dnsPreview.data && (
        <Card>
          <CardHeader>
            <CardTitle>Paste these records at your registrar</CardTitle>
            <CardDescription>Verification runs on save and again from the school detail page.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th>Kind</Th>
                  <Th>Name</Th>
                  <Th>Value</Th>
                  <Th>TTL</Th>
                </Tr>
              </THead>
              <TBody>
                {dnsPreview.data.records.map((r, i) => (
                  <Tr key={i}>
                    <Td className="font-mono">{r.kind}</Td>
                    <Td className="font-mono">{r.name}</Td>
                    <Td className="font-mono">{r.value}</Td>
                    <Td>{r.ttl}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CsvStep() {
  const w = useWizardStore();
  const [errorRows, setErrorRows] = useState<Array<{ kind: 'teacher' | 'student'; reason: string; raw: unknown }>>([]);

  function parse(kind: 'teacher' | 'student', text: string) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const header = lines[0].toLowerCase().split(',').map((s) => s.trim());
    const emailIdx = header.indexOf('email');
    const firstIdx = header.findIndex((h) => h === 'firstname' || h === 'first_name');
    const lastIdx = header.findIndex((h) => h === 'lastname' || h === 'last_name');
    if (emailIdx < 0 || firstIdx < 0 || lastIdx < 0) {
      toast.error('CSV must have columns: email, firstName, lastName');
      return;
    }
    const rows: CsvUser[] = [];
    const errors: Array<{ kind: 'teacher' | 'student'; reason: string; raw: unknown }> = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(',').map((s) => s.trim());
      const email = cols[emailIdx]?.toLowerCase();
      const firstName = cols[firstIdx];
      const lastName = cols[lastIdx];
      if (!email || !/^\S+@\S+\.\S+/.test(email)) {
        errors.push({ kind, reason: 'invalid email', raw: line });
        continue;
      }
      if (!firstName || !lastName) {
        errors.push({ kind, reason: 'firstName/lastName required', raw: line });
        continue;
      }
      rows.push({ email, firstName, lastName });
    }
    if (kind === 'teacher') w.patch({ initialTeachers: rows });
    else w.patch({ initialStudents: rows });
    setErrorRows((prev) => [...prev.filter((p) => p.kind !== kind), ...errors]);
    toast.success(`Parsed ${rows.length} valid ${kind} row${rows.length === 1 ? '' : 's'}.`);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Optional. Drop a CSV with header <code className="rounded bg-slate-100 px-1">email,firstName,lastName</code>.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Teachers</CardTitle>
            <CardDescription>{w.initialTeachers.length} queued</CardDescription>
          </CardHeader>
          <CardContent>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0]?.text().then((t) => parse('teacher', t))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Students</CardTitle>
            <CardDescription>{w.initialStudents.length} queued</CardDescription>
          </CardHeader>
          <CardContent>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0]?.text().then((t) => parse('student', t))}
            />
          </CardContent>
        </Card>
      </div>
      {errorRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invalid rows ({errorRows.length})</CardTitle>
            <CardDescription>These rows were skipped. Fix them and re-upload.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {errorRows.slice(0, 20).map((er, i) => (
                <li key={i} className="font-mono text-rose-600">
                  [{er.kind}] {er.reason}: {String(er.raw)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-slate-400">
        Need a template?{' '}
        <Link className="underline" href={(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/platform/imports/template'}>
          Download CSV template
        </Link>
      </p>
    </div>
  );
}

function ReviewStep() {
  const w = useWizardStore();
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value || <span className="text-slate-400">—</span>}</span>
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Basics</h3>
        <Field label="Name" value={w.name} />
        <Field label="Slug" value={<code className="font-mono">{w.slug}.skoolos.app</code>} />
        <Field label="Admin" value={`${w.adminFirstName} ${w.adminLastName} <${w.adminEmail}>`} />
        <h3 className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Branding</h3>
        <Field label="Brand color" value={w.brandPrimary} />
        <Field label="Logo" value={w.logoUrl ? '✓' : '—'} />
        <Field label="Favicon" value={w.faviconUrl ? '✓' : '—'} />
        <Field label="About length" value={w.aboutPage?.length ?? 0} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Contact</h3>
        <Field label="City" value={[w.city, w.region, w.country].filter(Boolean).join(', ')} />
        <Field label="Timezone" value={w.timezone} />
        <Field label="Currency" value={w.currency} />
        <h3 className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Plan</h3>
        <Field label="Plan" value={<Badge tone="info">{w.subscriptionPlan}</Badge>} />
        <h3 className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Domain</h3>
        <Field label="Hostname" value={w.domainHostname} />
        <Field label="Type" value={w.domainType} />
        <h3 className="mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">CSV</h3>
        <Field label="Teachers" value={w.initialTeachers.length} />
        <Field label="Students" value={w.initialStudents.length} />
      </div>
    </div>
  );
}

