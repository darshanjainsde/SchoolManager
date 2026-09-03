'use client';
import { useMemo, useState } from 'react';
import { AudiencePicker, type AudienceKind } from './AudiencePicker';
import { ART_KEYS, EVENT_ART, EventArt, guessArt, type ArtKey } from './event-art';
import { EventCard, type EventScope, type SchoolEvent } from './event-card';

export interface CreateEventBody {
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  venue?: string;
  scope: EventScope;
  coverArt?: ArtKey;
  audienceKind?: AudienceKind;
  audienceSchoolIds?: string[];
}

/**
 * Making an event.
 *
 * The old form was a 32rem card dropped into a full-width console, so half the
 * screen was empty while the person filling it in had no idea what they were
 * making. The empty half is now a live preview of the card parents will see —
 * which is also the artwork every printed piece will use, so the decision that
 * matters most gets made where it is visible.
 *
 * Single column until 940px: on a phone the preview follows the fields rather
 * than competing with them.
 */
export function EventComposer({
  onSave,
  onCancel,
  isSaving,
}: {
  onSave: (body: CreateEventBody) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [venue, setVenue] = useState('');
  const [audienceKind, setAudienceKind] = useState<AudienceKind>('SCHOOL_ONLY');
  const [audienceSchoolIds, setAudienceSchoolIds] = useState<string[]>([]);
  /** Null = follow the title. Set only once somebody overrules the guess. */
  const [chosenArt, setChosenArt] = useState<ArtKey | null>(null);

  const guessed = useMemo(() => guessArt(title), [title]);
  const art = chosenArt ?? guessed;
  const scope: EventScope = audienceKind === 'SCHOOL_ONLY' ? 'SCHOOL' : 'NETWORK';

  const preview: SchoolEvent = {
    id: 'preview',
    title: title.trim() || 'Your event',
    description: description.trim() || null,
    startAt: startAt || new Date().toISOString(),
    endAt: endAt || null,
    venue: venue.trim() || null,
    scope,
    status: scope === 'NETWORK' ? 'PENDING' : 'APPROVED',
    coverArt: art,
    createdAt: new Date().toISOString(),
  };

  function submit() {
    const body: CreateEventBody = {
      title: title.trim(),
      startAt: new Date(startAt).toISOString(),
      scope,
      coverArt: art,
      audienceKind,
    };
    if (description.trim()) body.description = description.trim();
    if (endAt) body.endAt = new Date(endAt).toISOString();
    if (venue.trim()) body.venue = venue.trim();
    if (audienceKind === 'SELECTED') body.audienceSchoolIds = audienceSchoolIds;
    onSave(body);
  }

  const ready = title.trim().length > 0 && startAt.length > 0;

  return (
    <div className="sk-ev-compose">
      <div className="sk-card">
        <div className="sk-card-h"><h3>New event</h3></div>
        <div className="sk-card-b">
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Title</span>
            <input
              className="sk-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Annual Day 2026"
            />
          </label>

          <label style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Description</span>
            <textarea
              className="sk-input"
              rows={3}
              style={{ resize: 'vertical' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is happening, and who it is for."
            />
          </label>

          <div className="sk-ev-two">
            <label style={{ display: 'grid', gap: 5 }}>
              <span className="sk-lab">Starts</span>
              <input className="sk-input" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              <span className="sk-lab">Ends (optional)</span>
              <input className="sk-input" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Venue</span>
            <input className="sk-input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="School auditorium" />
          </label>

          <div style={{ display: 'grid', gap: 6 }}>
            <span className="sk-lab">Cover</span>
            <div className="sk-ev-artrow">
              {ART_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="sk-ev-artpick"
                  aria-pressed={art === k}
                  aria-label={EVENT_ART[k].name}
                  title={EVENT_ART[k].name}
                  onClick={() => setChosenArt(k)}
                >
                  <EventArt kind={k} />
                </button>
              ))}
            </div>
            <span className="sk-muted" style={{ fontSize: 11 }}>
              {chosenArt
                ? `${EVENT_ART[art].name}, chosen by hand.`
                : `${EVENT_ART[art].name} — picked from the title. Choose another if it is wrong.`}
            </span>
          </div>

          <AudiencePicker
            kind={audienceKind}
            onKindChange={(k) => {
              setAudienceKind(k);
              if (k !== 'SELECTED') setAudienceSchoolIds([]);
            }}
            selectedIds={audienceSchoolIds}
            onSelectedChange={setAudienceSchoolIds}
          />

          <div className="sk-ev-outrow" style={{ marginTop: 4 }}>
            <button className="sk-btn" data-variant="primary" type="button" disabled={!ready || isSaving} onClick={submit}>
              {isSaving ? 'Creating…' : ready ? 'Create event' : 'Add a title and a date'}
            </button>
            <button className="sk-btn" type="button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>As it will look</h3>
          <span className="sp" />
          <span className="sk-pill" data-tone="info">live</span>
        </div>
        <div className="sk-card-b">
          <EventCard event={preview} />
          <p className="sk-muted" style={{ fontSize: 11.5 }}>
            This is the card parents see on your website — and the artwork every printed poster,
            handbill and invitation will use.
          </p>
        </div>
      </div>
    </div>
  );
}
