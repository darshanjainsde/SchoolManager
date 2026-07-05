'use client';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';

// ── Types ──────────────────────────────────────────────────────────────────

interface SchoolDetail {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  features: string[];
  domains: Array<{ hostname: string; status: string; isPrimary: boolean }>;
}

// ── Tier → feature map (authoritative on the web side for labeling) ─────────

const ALL_FEATURES = [
  'PUBLIC_SITE',
  'GALLERY',
  'ENQUIRY',
  'SOCIAL',
  'ABOUT_CONTACT',
  'EVENTS',
  'MANAGEMENT',
] as const;

type FeatureKey = (typeof ALL_FEATURES)[number];

const TIER_FEATURES: Record<SchoolDetail['tier'], ReadonlySet<FeatureKey>> = {
  BASIC: new Set(['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL']),
  STANDARD: new Set(['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL', 'ABOUT_CONTACT', 'EVENTS']),
  PRO: new Set(['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL', 'ABOUT_CONTACT', 'EVENTS', 'MANAGEMENT']),
};

const TIER_TONE: Record<SchoolDetail['tier'], 'neutral' | 'info' | 'success'> = {
  BASIC: 'neutral',
  STANDARD: 'info',
  PRO: 'success',
};

// ── Page ───────────────────────────────────────────────────────────────────

export default function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });
  const qc = useQueryClient();
  const refreshToken = useAuthStore((s) => s.refreshToken);

  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-school', id],
    queryFn: () => api.get<SchoolDetail>(`/owner/schools/${id}`),
    enabled: !!refreshToken,
  });

  // ── Tier mutation ────────────────────────────────────────────────────────
  const tierMutation = useMutation({
    mutationFn: (tier: SchoolDetail['tier']) =>
      api.patch<SchoolDetail>(`/owner/schools/${id}/tier`, { tier }),
    onSuccess: () => {
      toast.success('Tier updated');
      qc.invalidateQueries({ queryKey: ['owner-schools'] });
      qc.invalidateQueries({ queryKey: ['owner-school', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Feature toggle mutation ──────────────────────────────────────────────
  const featureMutation = useMutation({
    mutationFn: ({ featureKey, enabled }: { featureKey: string; enabled: boolean }) =>
      api.patch<SchoolDetail>(`/owner/schools/${id}/features`, { featureKey, enabled }),
    onSuccess: () => {
      toast.success('Feature updated');
      qc.invalidateQueries({ queryKey: ['owner-schools'] });
      qc.invalidateQueries({ queryKey: ['owner-school', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Publish / status mutation (go-live) ──────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: (status: 'SETUP' | 'LIVE' | 'SUSPENDED') =>
      api.patch<SchoolDetail>(`/owner/schools/${id}/status`, { status }),
    onSuccess: (_d, status) => {
      toast.success(
        status === 'LIVE' ? 'School published — public site is live' : `Status set to ${status}`,
      );
      qc.invalidateQueries({ queryKey: ['owner-schools'] });
      qc.invalidateQueries({ queryKey: ['owner-school', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Loading / error states ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-8 text-sm text-slate-500">Loading school…</div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-sm text-rose-600">
        {error ? (error as Error).message : 'School not found.'}
      </div>
    );
  }

  const school = data;
  const tierFeatures = TIER_FEATURES[school.tier];
  const featureSet = new Set(school.features);

  return (
    <div className="p-8 flex flex-col gap-6">
      {/* Header ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-900">{school.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{school.slug}</code>
          <Badge tone={TIER_TONE[school.tier]}>{school.tier}</Badge>
          <Badge
            tone={
              school.status === 'LIVE' ? 'success' : school.status === 'SUSPENDED' ? 'danger' : 'neutral'
            }
          >
            {school.status}
          </Badge>
          {school.primaryDomain && (
            <span className="font-mono text-xs">{school.primaryDomain}</span>
          )}
        </div>
        {/* Go-live controls */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {school.status !== 'LIVE' ? (
            <Button
              size="sm"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate('LIVE')}
            >
              {statusMutation.isPending ? 'Publishing…' : 'Publish (go live)'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate('SETUP')}
            >
              Unpublish
            </Button>
          )}
          {school.status !== 'SUSPENDED' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate('SUSPENDED')}
            >
              Suspend
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate('LIVE')}
            >
              Reinstate
            </Button>
          )}
        </div>
      </header>

      {/* Tier selector ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription tier</CardTitle>
          <CardDescription>
            Changing the tier immediately adjusts which features are unlocked by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex flex-col gap-1.5 w-full sm:w-56">
            <Label htmlFor="tier-select">Tier</Label>
            <Select
              id="tier-select"
              value={school.tier}
              disabled={tierMutation.isPending}
              onChange={(e) =>
                tierMutation.mutate(e.target.value as SchoolDetail['tier'])
              }
            >
              <option value="BASIC">Basic</option>
              <option value="STANDARD">Standard</option>
              <option value="PRO">Pro</option>
            </Select>
          </div>
          {tierMutation.isPending && (
            <span className="text-xs text-slate-500">Saving…</span>
          )}
        </CardContent>
      </Card>

      {/* Feature toggles ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Feature flags</CardTitle>
          <CardDescription>
            Tier-granted features are included in the plan. Override labels mean the
            feature was manually enabled or disabled outside the tier default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-slate-100">
            {ALL_FEATURES.map((key) => {
              const isEnabled = featureSet.has(key);
              const isTierGranted = tierFeatures.has(key);
              const pending = featureMutation.isPending && featureMutation.variables?.featureKey === key;

              // Determine label
              let labelTone: 'neutral' | 'info' | 'success' = 'neutral';
              let labelText = '';
              if (isEnabled) {
                if (isTierGranted) {
                  labelTone = 'info';
                  labelText = 'tier';
                } else {
                  labelTone = 'success';
                  labelText = 'override';
                }
              } else if (!isTierGranted) {
                labelTone = 'neutral';
                labelText = '';
              } else {
                // Tier would grant it but it's disabled — shouldn't normally happen
                // unless a manual override disabled it
                labelTone = 'neutral';
                labelText = 'tier-off';
              }

              return (
                <li key={key} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`feat-${key}`}
                      checked={isEnabled}
                      disabled={pending || featureMutation.isPending}
                      onChange={(e) =>
                        featureMutation.mutate({ featureKey: key, enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 cursor-pointer"
                    />
                    <label
                      htmlFor={`feat-${key}`}
                      className="text-sm font-mono text-slate-700 select-none cursor-pointer"
                    >
                      {key}
                    </label>
                    {labelText && (
                      <Badge tone={labelTone}>{labelText}</Badge>
                    )}
                  </div>
                  {pending && (
                    <span className="text-xs text-slate-400">Saving…</span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Domains list ────────────────────────────────────────────────────── */}
      {school.domains.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Domains</CardTitle>
            <CardDescription>{school.domains.length} domain{school.domains.length !== 1 ? 's' : ''} attached</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {school.domains.map((d) => (
                <li key={d.hostname} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-mono text-slate-800">{d.hostname}</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        d.status === 'LIVE'
                          ? 'success'
                          : d.status === 'ERROR'
                          ? 'danger'
                          : d.status === 'VERIFYING'
                          ? 'warning'
                          : 'neutral'
                      }
                    >
                      {d.status}
                    </Badge>
                    {d.isPrimary && <Badge tone="info">Primary</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
