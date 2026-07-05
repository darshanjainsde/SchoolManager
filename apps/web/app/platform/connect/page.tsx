'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  features: string[];
}

interface NetworkEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  venue: string | null;
  scope: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  schoolId: string;
  originSchoolName: string | null;
  school: { name: string; slug: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ConnectPage() {
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();

  // ── Pending events query ───────────────────────────────────────────────────
  const {
    data: pendingEvents,
    isLoading: loadingPending,
    error: pendingError,
  } = useQuery({
    queryKey: ['owner-events', 'PENDING'],
    queryFn: () => api.get<NetworkEvent[]>('/owner/events?status=PENDING'),
    enabled: !!refreshToken,
  });

  // ── Schools query (reuse key from schools page) ────────────────────────────
  const { data: schools } = useQuery({
    queryKey: ['owner-schools'],
    queryFn: () => api.get<SchoolRow[]>('/owner/schools'),
    enabled: !!refreshToken,
  });

  // ── Approve mutation ───────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch<NetworkEvent>(`/owner/events/${id}`, { action: 'APPROVE' }),
    onSuccess: () => {
      toast.success('Event approved');
      qc.invalidateQueries({ queryKey: ['owner-events', 'PENDING'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Reject mutation ────────────────────────────────────────────────────────
  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch<NetworkEvent>(`/owner/events/${id}`, { action: 'REJECT' }),
    onSuccess: () => {
      toast.success('Event rejected');
      qc.invalidateQueries({ queryKey: ['owner-events', 'PENDING'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = pendingEvents ?? [];

  // ── Create form state ──────────────────────────────────────────────────────
  const [form, setForm] = useState({
    schoolId: '',
    title: '',
    description: '',
    startAt: '',
    endAt: '',
    venue: '',
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<NetworkEvent>('/owner/events', {
        schoolId: form.schoolId,
        title: form.title,
        ...(form.description ? { description: form.description } : {}),
        startAt: new Date(form.startAt).toISOString(),
        ...(form.endAt ? { endAt: new Date(form.endAt).toISOString() } : {}),
        ...(form.venue ? { venue: form.venue } : {}),
      }),
    onSuccess: () => {
      toast.success('Network event created');
      setForm({ schoolId: '', title: '', description: '', startAt: '', endAt: '', venue: '' });
      qc.invalidateQueries({ queryKey: ['owner-events', 'PENDING'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const schoolList = schools ?? [];
  const canCreate = !!form.schoolId && !!form.title.trim() && !!form.startAt;

  return (
    <div className="p-8 flex flex-col gap-6">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Connect</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review and moderate cross-school network events.
        </p>
      </header>

      {/* Moderation queue */}
      <Card>
        <CardHeader>
          <CardTitle>Pending review</CardTitle>
          <CardDescription>
            {pending.length} event{pending.length !== 1 ? 's' : ''} awaiting review
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingPending && (
            <div className="text-sm text-slate-500">Loading…</div>
          )}
          {pendingError && (
            <div className="text-sm text-rose-600">{(pendingError as Error).message}</div>
          )}
          {!loadingPending && !pendingError && pending.length === 0 && (
            <div className="text-sm text-slate-500">No events awaiting review.</div>
          )}
          {!loadingPending && pending.length > 0 && (
            <Table>
              <THead>
                <Tr>
                  <Th>Title</Th>
                  <Th>School</Th>
                  <Th>Start</Th>
                  <Th>Venue</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {pending.map((ev) => {
                  const isActing =
                    (approveMutation.isPending && approveMutation.variables === ev.id) ||
                    (rejectMutation.isPending && rejectMutation.variables === ev.id);
                  return (
                    <Tr key={ev.id}>
                      <Td className="font-medium text-slate-900">{ev.title}</Td>
                      <Td className="text-slate-500">
                        {ev.school?.name ?? ev.originSchoolName ?? '—'}
                      </Td>
                      <Td className="text-slate-500 text-xs">{formatDate(ev.startAt)}</Td>
                      <Td className="text-slate-500">{ev.venue ?? '—'}</Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={isActing}
                            onClick={() => approveMutation.mutate(ev.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isActing}
                            onClick={() => rejectMutation.mutate(ev.id)}
                          >
                            Reject
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create network event form */}
      <Card>
        <CardHeader>
          <CardTitle>Create network event</CardTitle>
          <CardDescription>
            Create a cross-school network event for a specific school. It will be auto-approved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 max-w-lg">
            <div>
              <Label htmlFor="school-select" required>School</Label>
              <Select
                id="school-select"
                value={form.schoolId}
                onChange={(e) => setForm((f) => ({ ...f, schoolId: e.target.value }))}
              >
                <option value="">Select a school…</option>
                {schoolList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="ev-title" required>Title</Label>
              <Input
                id="ev-title"
                value={form.title}
                placeholder="e.g. Inter-school Science Fair"
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="ev-description">Description</Label>
              <Input
                id="ev-description"
                value={form.description}
                placeholder="Optional description"
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="ev-startAt" required>Start date &amp; time</Label>
                <Input
                  id="ev-startAt"
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="ev-endAt">End date &amp; time</Label>
                <Input
                  id="ev-endAt"
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="ev-venue">Venue</Label>
              <Input
                id="ev-venue"
                value={form.venue}
                placeholder="e.g. Main Auditorium"
                onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
              />
            </div>

            <Button
              disabled={!canCreate || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create event'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
