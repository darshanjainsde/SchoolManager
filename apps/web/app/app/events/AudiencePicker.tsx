'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { Label } from '@/components/ui/label';

export type AudienceKind = 'SCHOOL_ONLY' | 'CITY' | 'SELECTED';

interface Candidate {
  id: string;
  name: string;
  city: string | null;
}

interface Props {
  kind: AudienceKind;
  onKindChange: (k: AudienceKind) => void;
  selectedIds: string[];
  onSelectedChange: (ids: string[]) => void;
}

interface CandidateResponse {
  ownCity: string | null;
  schools: Candidate[];
}

const MAX_SELECTED = 50;

/**
 * Who sees this event.
 *
 * Replaces a two-option dropdown whose "Network" choice meant every school on
 * the platform, forever. The reach line under each option is the point: a
 * teacher should be able to see how far an event travels BEFORE publishing it,
 * not discover it afterwards.
 */
export function AudiencePicker({ kind, onKindChange, selectedIds, onSelectedChange }: Props) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [ownCity, setOwnCity] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetched on mount rather than only when picking schools: the "my city"
  // option needs the city to label itself, and one request answers both.
  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      api
        .get<CandidateResponse>(
          `/manage/events/audience-candidates${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
        )
        .then((res) => {
          if (cancelled) return;
          setCandidates(res.schools ?? []);
          setOwnCity(res.ownCity ?? null);
        })
        .catch(() => !cancelled && setCandidates([]))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, api]);

  const cityReach = useMemo(
    () => candidates.filter((c) => ownCity && c.city === ownCity).length,
    [candidates, ownCity],
  );

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onSelectedChange(selectedIds.filter((x) => x !== id));
    } else if (selectedIds.length < MAX_SELECTED) {
      onSelectedChange([...selectedIds, id]);
    }
  }

  const opt = (value: AudienceKind, label: string, hint: string, disabled = false) => (
    <label
      key={value}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 10,
        alignItems: 'start',
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${kind === value ? 'var(--sk-brand)' : 'var(--sk-line-2)'}`,
        background: kind === value ? 'var(--sk-card)' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="radio"
        name="audience"
        value={value}
        checked={kind === value}
        disabled={disabled}
        onChange={() => onKindChange(value)}
        style={{ marginTop: 3 }}
      />
      <span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--sk-muted)', marginTop: 2 }}>
          {hint}
        </span>
      </span>
    </label>
  );

  return (
    <div className="space-y-2">
      <Label>Who should see this event?</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {opt('SCHOOL_ONLY', 'Just my school', 'Shown only on your own website. Goes live immediately.')}
        {opt(
          'CITY',
          ownCity ? `My city — ${ownCity}` : 'My city',
          ownCity
            ? `Shown on the website of every school in ${ownCity}.${cityReach ? ` About ${cityReach} nearby.` : ''}`
            : 'Add your school’s city in Settings to use this.',
          !ownCity,
        )}
        {opt(
          'SELECTED',
          'Pick schools…',
          selectedIds.length
            ? `${selectedIds.length} school${selectedIds.length === 1 ? '' : 's'} chosen.`
            : 'Choose exactly which schools see it. Useful across cities.',
        )}
      </div>

      {kind === 'SELECTED' && (
        <div
          style={{
            marginTop: 4,
            border: '1px solid var(--sk-line-2)',
            borderRadius: 8,
            padding: 10,
            background: 'var(--sk-card)',
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search schools by name…"
            aria-label="Search schools"
            className="w-full rounded-md px-3 py-2 text-sm"
            style={{ border: '1px solid var(--sk-line-2)', background: 'transparent', color: 'var(--sk-ink)' }}
          />
          <div style={{ maxHeight: 208, overflowY: 'auto', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {loading && <p style={{ fontSize: 12, color: 'var(--sk-muted)', padding: 6 }}>Searching…</p>}
            {!loading && candidates.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--sk-muted)', padding: 6 }}>
                {query.trim() ? 'No schools match that name.' : 'No other schools are live yet.'}
              </p>
            )}
            {candidates.map((c) => {
              const on = selectedIds.includes(c.id);
              const full = !on && selectedIds.length >= MAX_SELECTED;
              return (
                <label
                  key={c.id}
                  style={{
                    display: 'flex',
                    gap: 9,
                    alignItems: 'center',
                    padding: '6px 7px',
                    borderRadius: 6,
                    cursor: full ? 'not-allowed' : 'pointer',
                    opacity: full ? 0.5 : 1,
                  }}
                >
                  <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(c.id)} />
                  <span style={{ fontSize: 13 }}>
                    {c.name}
                    {c.city && (
                      <span style={{ color: 'var(--sk-muted)' }}> · {c.city}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {selectedIds.length >= MAX_SELECTED && (
            <p style={{ fontSize: 12, color: 'var(--sk-amber)', marginTop: 6 }}>
              That’s the maximum of {MAX_SELECTED} schools. Use “My city” to reach more at once.
            </p>
          )}
        </div>
      )}

      {kind !== 'SCHOOL_ONLY' && (
        <p className="text-xs" style={{ color: 'var(--sk-amber)' }}>
          Shared events go to the network owner for approval, and show as “Pending” until approved.
        </p>
      )}
    </div>
  );
}
