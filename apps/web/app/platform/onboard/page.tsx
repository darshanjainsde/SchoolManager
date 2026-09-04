'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useWizardStore, type Tier } from '@/lib/wizard-store';
import { cn } from '@/lib/cn';

const STEPS = ['Basics', 'Choose tier', 'Confirm'];
const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const EMAIL_RE = /\S+@\S+\.\S+/;

// ── Validation ────────────────────────────────────────────────────────────────

interface ValidationErrors {
  name?: string;
  slug?: string;
  domainHostname?: string;
  adminEmail?: string;
}

function validateStep1(data: { name: string; slug: string; domainHostname: string; adminEmail: string }): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!data.name.trim()) errs.name = 'School name is required.';
  if (!SLUG_RE.test(data.slug)) errs.slug = 'Slug must be 2–40 lowercase letters, digits, or dashes.';
  if (!data.domainHostname.trim()) errs.domainHostname = 'Domain hostname is required.';
  if (!EMAIL_RE.test(data.adminEmail)) errs.adminEmail = 'Enter a valid email address.';
  return errs;
}

function isStep1Valid(data: { name: string; slug: string; domainHostname: string; adminEmail: string }): boolean {
  return Object.keys(validateStep1(data)).length === 0;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OnboardPage() {
  const w = useWizardStore();
  const router = useRouter();
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const [successInfo, setSuccessInfo] = useState<{ id: string; slug: string; tempPassword: string } | null>(null);

  const createSchool = useMutation({
    mutationFn: () =>
      api.post<{ id: string; slug: string; tempPassword: string }>('/owner/schools', {
        name: w.name,
        slug: w.slug,
        tier: w.tier,
        domainHostname: w.domainHostname,
        adminEmail: w.adminEmail,
      }),
    onSuccess: (data) => {
      setSuccessInfo(data);
      w.reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // After successful creation show a success panel with tempPassword
  if (successInfo) {
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <CardContent className="p-8 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-600 font-semibold text-lg">
              <Check className="h-6 w-6" /> School created
            </div>
            <p className="text-sm text-slate-600">
              School <strong>{successInfo.slug}</strong> has been provisioned. Share the temporary
              password below with the admin — they must change it on first login.
            </p>
            <div>
              <div className="sk-muted mb-1 font-medium">Temporary admin password</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 block rounded bg-slate-100 px-3 py-2 font-mono text-sm break-all">
                  {successInfo.tempPassword}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard?.writeText(successInfo.tempPassword);
                    toast.success('Copied to clipboard');
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>
            <Button
              className="mt-2"
              onClick={() => router.push('/platform/schools')}
            >
              Go to schools
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canGoNext =
    w.step === 1 ? isStep1Valid(w) :
    w.step === 2 ? Boolean(w.tier) :
    true;

  function handleNext() {
    if (w.step < STEPS.length) {
      w.set({ step: w.step + 1 });
    }
  }

  function handleBack() {
    if (w.step > 1) w.set({ step: w.step - 1 });
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="sk-own-h1">Add a new school</h1>
          <p className="sk-muted">Step {w.step} of {STEPS.length}: {STEPS[w.step - 1]}</p>
        </div>
        <Button variant="ghost" onClick={() => w.reset()}>Start over</Button>
      </header>

      <StepperBar step={w.step} />

      <Card>
        <CardContent className="p-6">
          {w.step === 1 && <BasicsStep />}
          {w.step === 2 && <TierStep />}
          {w.step === 3 && <ConfirmStep />}
        </CardContent>
        <div className="flex items-center justify-between border-t border-slate-100 p-6">
          <Button variant="ghost" disabled={w.step === 1} onClick={handleBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {w.step < STEPS.length ? (
            <Button onClick={handleNext} disabled={!canGoNext}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={() => createSchool.mutate()}
              disabled={createSchool.isPending}
            >
              {createSchool.isPending ? 'Creating…' : 'Create school'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Stepper indicator ─────────────────────────────────────────────────────────

function StepperBar({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li key={label} className="flex items-center gap-0 flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold shrink-0',
                  done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : active
                      ? 'border-slate-900 bg-white text-slate-900'
                      : 'border-slate-300 bg-white text-slate-400',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </span>
              <span className={cn('text-sm font-medium', active ? 'text-slate-900' : 'text-slate-400')}>
                {label}
              </span>
            </div>
            {n < STEPS.length && (
              <span className="flex-1 h-px bg-slate-200 mx-3" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Step 1: Basics ────────────────────────────────────────────────────────────

function BasicsStep() {
  const w = useWizardStore();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errs = validateStep1(w);

  function blur(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function autoSlug(name: string) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="name" required>School name</Label>
        <Input
          id="name"
          value={w.name}
          placeholder="e.g. Maple Leaf Academy"
          onChange={(e) => {
            const name = e.target.value;
            w.set({ name });
            // auto-fill slug only if slug is empty or matches previous auto-value
            if (!w.slug || w.slug === autoSlug(w.name)) {
              w.set({ name, slug: autoSlug(name) });
            } else {
              w.set({ name });
            }
          }}
          onBlur={() => blur('name')}
        />
        {touched.name && errs.name && (
          <p className="mt-1 text-xs text-rose-600">{errs.name}</p>
        )}
      </div>

      <div>
        <Label htmlFor="slug" required hint="Lowercase letters, digits, dashes (2–40 chars)">URL slug</Label>
        <Input
          id="slug"
          value={w.slug}
          placeholder="maple-leaf"
          onChange={(e) => w.set({ slug: e.target.value.toLowerCase() })}
          onBlur={() => blur('slug')}
        />
        {touched.slug && errs.slug && (
          <p className="mt-1 text-xs text-rose-600">{errs.slug}</p>
        )}
      </div>

      <div>
        <Label htmlFor="domainHostname" required hint="Domain already bought and pointed to your server">Domain hostname</Label>
        <Input
          id="domainHostname"
          value={w.domainHostname}
          placeholder="mapleleaf.edu or maple.localhost"
          onChange={(e) => w.set({ domainHostname: e.target.value.toLowerCase() })}
          onBlur={() => blur('domainHostname')}
        />
        {touched.domainHostname && errs.domainHostname && (
          <p className="mt-1 text-xs text-rose-600">{errs.domainHostname}</p>
        )}
      </div>

      <div>
        <Label htmlFor="adminEmail" required>Admin email</Label>
        <Input
          id="adminEmail"
          type="email"
          value={w.adminEmail}
          placeholder="admin@mapleleaf.edu"
          onChange={(e) => w.set({ adminEmail: e.target.value })}
          onBlur={() => blur('adminEmail')}
        />
        {touched.adminEmail && errs.adminEmail && (
          <p className="mt-1 text-xs text-rose-600">{errs.adminEmail}</p>
        )}
      </div>
    </div>
  );
}

// ── Step 2: Choose tier ───────────────────────────────────────────────────────

const TIERS: Array<{ key: Tier; label: string; tagline: string; description: string; popular?: boolean }> = [
  {
    key: 'BASIC',
    label: 'Basic',
    tagline: 'website only',
    description: 'Homepage · Gallery · Enquiry form · Social links',
  },
  {
    key: 'STANDARD',
    label: 'Standard',
    tagline: '',
    description: 'Everything in Basic · About & Contact pages · Connect events',
    popular: true,
  },
  {
    key: 'PRO',
    label: 'Pro',
    tagline: 'website + management',
    description: 'Everything in Standard · Admin management: classes, teachers, students, timetable',
  },
];

function TierStep() {
  const w = useWizardStore();
  return (
    <div className="flex flex-col gap-3">
      <p className="sk-muted">Pick what this school gets. You can change this later.</p>
      {TIERS.map((t) => {
        const selected = w.tier === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => w.set({ tier: t.key })}
            className={cn(
              'flex gap-3 rounded-xl border-2 p-4 text-left transition-all',
              selected
                ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                : 'border-slate-200 hover:border-slate-400',
            )}
          >
            <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center
              border-slate-400">
              {selected && <div className="h-2 w-2 rounded-full bg-slate-900" />}
            </div>
            <div>
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                {t.label}
                {t.tagline && (
                  <span className="text-xs font-normal text-slate-400">— {t.tagline}</span>
                )}
                {t.popular && (
                  <Badge tone="info">Popular</Badge>
                )}
              </div>
              <p className="mt-1 sk-muted">{t.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Step 3: Confirm ───────────────────────────────────────────────────────────

function ConfirmStep() {
  const w = useWizardStore();

  const tierLabel = TIERS.find((t) => t.key === w.tier)?.label ?? w.tier;

  return (
    <div className="flex flex-col gap-4">
      <p className="sk-muted">
        Review the details below. On create, the school record is provisioned and a temporary
        admin password is generated for you to share.
      </p>
      <div className="rounded-xl bg-slate-50 p-5 text-sm space-y-3">
        <ConfirmRow label="School name" value={w.name} />
        <ConfirmRow label="Slug" value={<code className="font-mono">{w.slug}</code>} />
        <ConfirmRow label="Domain" value={w.domainHostname} />
        <ConfirmRow label="Admin email" value={w.adminEmail} />
        <ConfirmRow
          label="Tier"
          value={<Badge tone="info">{tierLabel}</Badge>}
        />
      </div>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-medium text-slate-900 text-right">{value}</span>
    </div>
  );
}
