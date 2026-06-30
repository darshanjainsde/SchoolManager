'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';

interface KeyRow { key: string; scope: string; updatedAt: string }
interface IntegrationStatus {
  stripe: boolean;
  resend: boolean;
  ably: boolean;
  otel: boolean;
}

const INTEGRATIONS: Array<{
  id: keyof IntegrationStatus;
  label: string;
  blurb: string;
  fields: Array<{ key: string; label: string; placeholder: string; secret: boolean }>;
}> = [
  {
    id: 'stripe',
    label: 'Stripe',
    blurb: 'Process per-school fee payments and platform subscriptions.',
    fields: [
      { key: 'stripe.secretKey', label: 'Secret key (sk_…)', placeholder: 'sk_test_…', secret: true },
      { key: 'stripe.publishableKey', label: 'Publishable key (pk_…)', placeholder: 'pk_test_…', secret: false },
      { key: 'stripe.webhookSecret', label: 'Webhook signing secret (whsec_…)', placeholder: 'whsec_…', secret: true },
    ],
  },
  {
    id: 'resend',
    label: 'Resend',
    blurb: 'Production email delivery for invites, receipts, announcements.',
    fields: [
      { key: 'resend.apiKey', label: 'API key', placeholder: 're_…', secret: true },
      { key: 'resend.fromEmail', label: 'From address', placeholder: '"SkoolOS" <no-reply@school.tld>', secret: false },
    ],
  },
  {
    id: 'ably',
    label: 'Ably (optional)',
    blurb: 'Realtime fan-out. If unset, SkoolOS falls back to server-sent events.',
    fields: [{ key: 'ably.apiKey', label: 'API key', placeholder: 'app.key:secret', secret: true }],
  },
  {
    id: 'otel',
    label: 'OpenTelemetry',
    blurb: 'Push traces + metrics to Grafana Cloud / Honeycomb / Tempo.',
    fields: [
      { key: 'otel.endpoint', label: 'OTLP endpoint', placeholder: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp', secret: false },
      { key: 'otel.headers', label: 'OTLP headers (JSON)', placeholder: '{"Authorization":"Basic …"}', secret: true },
    ],
  },
];

export default function PlatformSettingsPage() {
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });
  const qc = useQueryClient();

  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get<IntegrationStatus>('/platform/settings/integrations'),
  });
  const keys = useQuery({
    queryKey: ['settings-keys'],
    queryFn: () => api.get<KeyRow[]>('/platform/settings'),
  });

  const configured = new Set((keys.data ?? []).map((k) => k.key));

  const set = useMutation({
    mutationFn: (vars: { key: string; value: string }) =>
      api.post('/platform/settings', { key: vars.key, value: vars.value }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['settings-keys'] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unset = useMutation({
    mutationFn: (key: string) => api.del(`/platform/settings/${encodeURIComponent(key)}`),
    onSuccess: () => {
      toast.success('Cleared');
      qc.invalidateQueries({ queryKey: ['settings-keys'] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Platform settings</h1>
        <p className="text-sm text-slate-500">
          Secrets stored encrypted (AES-256-GCM). Stored values are never displayed; clear+set to rotate.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {INTEGRATIONS.map((it) => (
          <Card key={it.id}>
            <CardHeader>
              <CardDescription>{it.label}</CardDescription>
              <CardTitle>
                {integrations.data?.[it.id] ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not set</Badge>}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {INTEGRATIONS.map((it) => (
        <IntegrationCard
          key={it.id}
          spec={it}
          configured={configured}
          onSet={(key, value) => set.mutate({ key, value })}
          onUnset={(key) => unset.mutate(key)}
          pending={set.isPending || unset.isPending}
        />
      ))}
    </div>
  );
}

function IntegrationCard({
  spec,
  configured,
  onSet,
  onUnset,
  pending,
}: {
  spec: (typeof INTEGRATIONS)[number];
  configured: Set<string>;
  onSet: (key: string, value: string) => void;
  onUnset: (key: string) => void;
  pending: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <Card>
      <CardHeader>
        <CardTitle>{spec.label}</CardTitle>
        <CardDescription>{spec.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {spec.fields.map((f) => {
          const isSet = configured.has(f.key);
          return (
            <div key={f.key}>
              <Label>{f.label} {isSet && <Badge tone="success">Set</Badge>}</Label>
              <div className="flex gap-2">
                <Input
                  type={f.secret ? 'password' : 'text'}
                  placeholder={isSet ? '••••••• (saved — enter new value to rotate)' : f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
                <Button
                  size="sm"
                  disabled={!values[f.key] || pending}
                  onClick={() => {
                    onSet(f.key, values[f.key]);
                    setValues((v) => ({ ...v, [f.key]: '' }));
                  }}
                >
                  Save
                </Button>
                {isSet && (
                  <Button size="sm" variant="ghost" onClick={() => onUnset(f.key)} disabled={pending}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
