'use client';
import Link from 'next/link';
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
  coverAssetId?: string;
}

interface MediaAsset {
  id: string;
  url: string;
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
      <span className="sk-pill" data-tone="info">
        Network
      </span>
    );
  }
  return (
    <span className="sk-pill" data-tone="neutral">
      School
    </span>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  const tones: Record<EventStatus, string> = {
    APPROVED: 'good',
    PENDING: 'warn',
    REJECTED: 'bad',
    DRAFT: 'neutral',
  };
  const labels: Record<EventStatus, string> = {
    APPROVED: 'Approved',
    PENDING: 'Pending',
    REJECTED: 'Rejected',
    DRAFT: 'Draft',
  };
  return (
    <span className="sk-pill" data-tone={tones[status]}>
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
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [venue, setVenue] = useState('');
  const [scope, setScope] = useState<EventScope>('SCHOOL');
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadBanner(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=EVENT', { method: 'POST', body: fd });
      setCoverAssetId(asset.id);
      setCoverPreview(asset.url);
      toast.success('Banner uploaded');
    } catch (err) {
      toast.error(`Banner upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit() {
    const body: CreateEventBody = {
      title: title.trim(),
      startAt: new Date(startAt).toISOString(),
      scope,
    };
    if (description.trim()) body.description = description.trim();
    if (endAt) body.endAt = new Date(endAt).toISOString();
    if (venue.trim()) body.venue = venue.trim();
    if (coverAssetId) body.coverAssetId = coverAssetId;
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
            className="w-full rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none resize-none"
            style={{ border: '1px solid var(--sk-line-2)', background: 'var(--sk-card)', color: 'var(--sk-ink)' }}
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
          <Label htmlFor="ev-banner">Banner image (optional)</Label>
          {coverPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverPreview} alt="Event banner preview" className="h-32 w-full rounded-lg border object-cover" style={{ borderColor: 'var(--sk-line)' }} loading="lazy" decoding="async" />
          )}
          <Input
            id="ev-banner"
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadBanner(f);
            }}
          />
          <p className="text-xs" style={{ color: 'var(--sk-ink-3)' }}>
            {uploading ? 'Uploading…' : 'Shown on your events page — and across the network for network events. Wide images (16:9) look best.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ev-scope">Scope</Label>
          <select
            id="ev-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as EventScope)}
            className="w-full rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none"
            style={{ border: '1px solid var(--sk-line-2)', background: 'var(--sk-card)', color: 'var(--sk-ink)' }}
          >
            <option value="SCHOOL">School — visible to your school only</option>
            <option value="NETWORK">Network — submitted to network owner for approval</option>
          </select>
          {scope === 'NETWORK' && (
            <p className="text-xs" style={{ color: 'var(--sk-amber)' }}>
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
  // Id of the event created in this session — see `sk-pinin` on the list.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

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
      // Which card is the new one — see `sk-pinin` on the list below.
      setJustAddedId(event?.id ?? null);
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
      {/* `sk-pagehead` rather than a bare h1: it is what sets every heading in
          this portal in the pitch's serif, so Events reads as the same document
          as the rest of the admin desk. */}
      <header className="sk-pagehead flex items-center justify-between" style={{ marginBottom: 0 }}>
        <div>
          <h1>Events</h1>
          <p>Manage school events and network submissions.</p>
        </div>
        <Button
          className="sk-press"
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
        <p className="text-sm" style={{ color: 'var(--sk-ink-3)' }}>Loading events…</p>
      )}
      {eventsQuery.error && (
        <p className="text-sm" style={{ color: 'var(--sk-bad)' }}>
          {(eventsQuery.error as Error).message}
        </p>
      )}

      {/* Empty state */}
      {!eventsQuery.isLoading && eventsQuery.data?.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CalendarHeart className="h-10 w-10" style={{ color: 'var(--sk-ink-3)' }} />
          <p className="text-sm" style={{ color: 'var(--sk-ink-3)' }}>No events yet. Create one above.</p>
        </div>
      )}

      {/* Events list */}
      {(eventsQuery.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3">
          {eventsQuery.data!.map((event) => (
            // `sk-pinin` on the event just created: the list is date-ordered,
            // so a new event drops into the middle of it. The gesture points
            // at where it landed; reduced motion shows it already in place.
            <Card key={event.id} className={event.id === justAddedId ? 'sk-pinin sk-in' : undefined}>
              <CardContent className="flex items-start justify-between gap-4 pt-4">
                {event.coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={event.coverUrl} alt="" className="h-20 w-32 shrink-0 rounded-lg border object-cover" style={{ borderColor: 'var(--sk-line)' }} loading="lazy" decoding="async" />
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-semibold truncate" style={{ color: 'var(--sk-ink)' }}>{event.title}</p>
                  <p className="text-sm" style={{ color: 'var(--sk-ink-3)' }}>
                    {formatDateRange(event.startAt, event.endAt)}
                  </p>
                  {event.venue && (
                    <p className="text-sm truncate" style={{ color: 'var(--sk-ink-3)' }}>📍 {event.venue}</p>
                  )}
                  {event.description && (
                    <p className="text-sm line-clamp-2" style={{ color: 'var(--sk-ink-3)' }}>{event.description}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <ScopeBadge scope={event.scope} />
                    <StatusBadge status={event.status} />
                  </div>
                </div>
                {/* An event is now something you can OPEN. It was previously a
                    poster with a delete button — the only thing you could do to
                    an event was destroy it, because there was nothing behind it
                    to look at. */}
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/app/events/${event.id}`}
                    className="sk-btn sk-press"
                    data-variant="primary"
                    data-testid={`open-${event.id}`}
                  >
                    Who&rsquo;s coming
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(event.id)}
                    className="sk-press"
                    style={{ color: 'var(--sk-bad)' }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
