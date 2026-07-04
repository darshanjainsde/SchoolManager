'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, X, CalendarHeart } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ────────────────────────────────────────────────────────────────────

type EventScope = 'SCHOOL' | 'NETWORK';
type EventStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

interface SchoolEvent {
  id: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt?: string | null;
  venue?: string | null;
  scope: EventScope;
  status: EventStatus;
  coverAssetId?: string | null;
  coverUrl?: string | null;
  originSchoolName?: string | null;
  createdAt: string;
}

interface CreateEventBody {
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  venue?: string;
  scope: EventScope;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateRange(startAt: string, endAt?: string | null): string {
  const start = new Date(startAt);
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  };
  const startStr = start.toLocaleString(undefined, opts);
  if (!endAt) return startStr;
  const end = new Date(endAt);
  return `${startStr} – ${end.toLocaleString(undefined, opts)}`;
}

function ScopeBadge({ scope }: { scope: EventScope }) {
  if (scope === 'NETWORK') {
    return (
      <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
        Network
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
      School
    </span>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  const styles: Record<EventStatus, string> = {
    APPROVED: 'bg-green-100 text-green-700',
    PENDING: 'bg-amber-100 text-amber-700',
    REJECTED: 'bg-rose-100 text-rose-700',
    DRAFT: 'bg-slate-100 text-slate-600',
  };
  const labels: Record<EventStatus, string> = {
    APPROVED: 'Approved',
    PENDING: 'Pending',
    REJECTED: 'Rejected',
    DRAFT: 'Draft',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

interface EventFormProps {
  onSave: (data: CreateEventBody) => void;
  isSaving: boolean;
  onCancel: () => void;
}

function EventForm({ onSave, isSaving, onCancel }: EventFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [venue, setVenue] = useState('');
  const [scope, setScope] = useState<EventScope>('SCHOOL');

  function handleSubmit() {
    const body: CreateEventBody = {
      title: title.trim(),
      startAt: new Date(startAt).toISOString(),
      scope,
    };
    if (description.trim()) body.description = description.trim();
    if (endAt) body.endAt = new Date(endAt).toISOString();
    if (venue.trim()) body.venue = venue.trim();
    onSave(body);
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>New event</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ev-title">Title *</Label>
          <Input
            id="ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Spring Fair 2026"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ev-desc">Description (optional)</Label>
          <textarea
            id="ev-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A brief description of the event…"
            rows={3}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ev-start">Start date &amp; time *</Label>
            <Input
              id="ev-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ev-end">End date &amp; time (optional)</Label>
            <Input
              id="ev-end"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ev-venue">Venue (optional)</Label>
          <Input
            id="ev-venue"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="Main Hall"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ev-scope">Scope</Label>
          <select
            id="ev-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as EventScope)}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="SCHOOL">School — visible to your school only</option>
            <option value="NETWORK">Network — submitted to network owner for approval</option>
          </select>
          {scope === 'NETWORK' && (
            <p className="text-xs text-amber-600">
              Network events are submitted to the network owner for approval and will show as
              &ldquo;Pending&rdquo; until approved.
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={handleSubmit} disabled={isSaving || !title.trim() || !startAt}>
          {isSaving ? 'Creating…' : 'Create event'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);

  // ── Query ─────────────────────────────────────────────────────────────────
  const eventsQuery = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get<SchoolEvent[]>('/manage/events'),
    enabled: !!host,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: CreateEventBody) => api.post<SchoolEvent>('/manage/events', body),
    onSuccess: (event) => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowAdd(false);
      if (event.scope === 'NETWORK') {
        toast.success('Network event submitted — awaiting owner approval.');
      } else {
        toast.success('Event created.');
      }
    },
    onError: (err: Error) => toast.error(`Failed to create event: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/events/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success('Event deleted.');
    },
    onError: (err: Error) => toast.error(`Failed to delete event: ${err.message}`),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Events</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage school events and network submissions.
          </p>
        </div>
        <Button
          onClick={() => setShowAdd((v) => !v)}
          variant="outline"
        >
          {showAdd ? (
            <>
              <X className="h-4 w-4 mr-1" /> Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" /> New event
            </>
          )}
        </Button>
      </header>

      {/* Create form */}
      {showAdd && (
        <EventForm
          onSave={(data) => createMutation.mutate(data)}
          isSaving={createMutation.isPending}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Loading / error states */}
      {eventsQuery.isLoading && (
        <p className="text-sm text-slate-500">Loading events…</p>
      )}
      {eventsQuery.error && (
        <p className="text-sm text-rose-600">
          {(eventsQuery.error as Error).message}
        </p>
      )}

      {/* Empty state */}
      {!eventsQuery.isLoading && eventsQuery.data?.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CalendarHeart className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No events yet. Create one above.</p>
        </div>
      )}

      {/* Events list */}
      {(eventsQuery.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3">
          {eventsQuery.data!.map((event) => (
            <Card key={event.id}>
              <CardContent className="flex items-start justify-between gap-4 pt-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-semibold text-slate-800 truncate">{event.title}</p>
                  <p className="text-sm text-slate-500">
                    {formatDateRange(event.startAt, event.endAt)}
                  </p>
                  {event.venue && (
                    <p className="text-sm text-slate-500 truncate">📍 {event.venue}</p>
                  )}
                  {event.description && (
                    <p className="text-sm text-slate-400 line-clamp-2">{event.description}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <ScopeBadge scope={event.scope} />
                    <StatusBadge status={event.status} />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(event.id)}
                  className="text-rose-500 hover:bg-rose-50 hover:text-rose-700 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
