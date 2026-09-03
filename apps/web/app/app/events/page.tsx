'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { EventCard, type SchoolEvent } from './event-card';
import { EventComposer, type CreateEventBody } from './composer';

type Tab = 'upcoming' | 'pending' | 'done';

const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'pending', label: 'Awaiting approval' },
  { id: 'done', label: 'Done' },
];

/**
 * Events.
 *
 * Rebuilt off `components/ui/*` — the shadcn kit this page was one of the last
 * console screens still using, which is why its buttons and cards read as a
 * different product from Exam Hall next door. Everything here is the console's
 * own `sk-*` system.
 *
 * The list is a card grid rather than stacked rows because an event is a thing
 * you look at, not a record you audit; and every card now carries artwork, so
 * a school with no photographer still has a page worth showing a parent.
 */
export default function EventsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');

  const eventsQuery = useQuery({
    queryKey: ['events', host],
    queryFn: () => api.get<SchoolEvent[]>('/manage/events'),
    enabled: !!host,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateEventBody) => api.post<SchoolEvent>('/manage/events', body),
    onSuccess: (event) => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowAdd(false);
      if (event.scope === 'NETWORK') {
        toast.success('Network event submitted — awaiting owner approval.');
        setTab('pending');
      } else {
        toast.success('Event created. Its Promo Kit is ready.');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/manage/events/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success('Event deleted.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Split once, so each tab's count is available for its own badge.
  const groups = useMemo(() => {
    const all = eventsQuery.data ?? [];
    const now = Date.now();
    const ended = (e: SchoolEvent) => new Date(e.endAt ?? e.startAt).getTime() < now;
    return {
      upcoming: all.filter((e) => !ended(e) && e.status !== 'PENDING').sort((a, b) => a.startAt.localeCompare(b.startAt)),
      pending: all.filter((e) => e.status === 'PENDING'),
      done: all.filter((e) => ended(e) && e.status !== 'PENDING').sort((a, b) => b.startAt.localeCompare(a.startAt)),
    };
  }, [eventsQuery.data]);

  const shown = groups[tab];
  const EMPTY: Record<Tab, string> = {
    upcoming: 'Nothing coming up. Create an event and it will be ready to print the moment it exists.',
    pending: 'Nothing waiting. Events sent to other schools appear here until an owner approves them.',
    done: 'Nothing finished yet.',
  };

  return (
    <div className="skosx">
      <header className="sk-pagehead">
        <div>
          <h1>Events</h1>
          <p>Everything happening at the school — and everything you need to put it on a wall.</p>
        </div>
        <button className="sk-btn" data-variant="primary" type="button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : 'New event'}
        </button>
      </header>

      {showAdd ? (
        <div style={{ marginBottom: 22 }}>
          <EventComposer
            onSave={(body) => createMutation.mutate(body)}
            onCancel={() => setShowAdd(false)}
            isSaving={createMutation.isPending}
          />
        </div>
      ) : null}

      <nav className="sk-tabs sk-lib-tabs" aria-label="Event groups">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="sk-tab"
            data-active={tab === t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {groups[t.id].length ? (
              <span className="sk-pill" data-tone={t.id === 'pending' ? 'warn' : 'neutral'}>
                {groups[t.id].length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {eventsQuery.isLoading ? <p className="sk-state">Reading the calendar…</p> : null}
      {eventsQuery.error ? <p className="sk-state err">{(eventsQuery.error as Error).message}</p> : null}

      {!eventsQuery.isLoading && !eventsQuery.error && shown.length === 0 ? (
        <p className="sk-state">{EMPTY[tab]}</p>
      ) : null}

      {shown.length > 0 ? (
        <div className="sk-ev-grid">
          {shown.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              past={tab === 'done'}
              onDelete={() => deleteMutation.mutate(event.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === event.id}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
