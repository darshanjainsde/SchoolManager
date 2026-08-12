'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readSession } from '@/lib/session';
import { searchTitles, spineHue, type TitleHit } from '@/lib/catalogue';
import { ApiError } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; hits: TitleHit[] }
  | { kind: 'error'; message: string };

export default function CataloguePage() {
  const [q, setQ] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [selected, setSelected] = useState<TitleHit | null>(null);

  // One in-flight search at a time. Without this, a fast typist's earlier
  // request can resolve AFTER a later one and overwrite the newer results
  // with staler ones — the bug looks like "search shows the wrong thing
  // intermittently" and is miserable to reproduce.
  const inflight = useRef<AbortController | null>(null);

  const run = useCallback(async (query: string) => {
    const session = readSession();
    if (!session) return;

    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;

    setState({ kind: 'loading' });
    try {
      const hits = await searchTitles(session.host, session.accessToken, query, {
        limit: 60,
        signal: ctrl.signal,
      });
      if (!ctrl.signal.aborted) setState({ kind: 'ready', hits });
    } catch (err) {
      if (ctrl.signal.aborted) return; // superseded, not a failure
      setState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reach the library.',
      });
    }
  }, []);

  // Debounced so a typist issues one search per pause, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void run(q), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, run]);

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Catalogue</h2>
          <p>Search by title, author, publisher, ISBN or call number.</p>
        </div>
      </div>

      <div className="lbx-field" style={{ maxWidth: '28rem', marginBottom: '1.1rem' }}>
        <label htmlFor="q">Search</label>
        <input
          id="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ghosh, 9780007216147, 823.914…"
          autoFocus
        />
      </div>

      {state.kind === 'error' ? (
        <div className="lbx-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.message}</span>
        </div>
      ) : null}

      {state.kind === 'loading' ? (
        <p style={{ color: 'var(--lb-ink-3)', fontSize: '.86rem' }}>Searching…</p>
      ) : null}

      {state.kind === 'ready' && state.hits.length === 0 ? (
        <p style={{ color: 'var(--lb-ink-2)', fontSize: '.9rem' }}>
          {q
            ? `Nothing matches “${q}”. Try an author surname, or part of the title.`
            : 'This catalogue is empty. Add a title, or import a CSV.'}
        </p>
      ) : null}

      {state.kind === 'ready' && state.hits.length > 0 ? (
        <>
          <div className="lbx-shelf" role="list" aria-label="Search results as book spines">
            {state.hits.slice(0, 24).map((t) => (
              <button
                key={t.id}
                role="listitem"
                className="lbx-spine"
                style={{ background: `linear-gradient(160deg, hsl(${spineHue(t.id)} 42% 34%), hsl(${spineHue(t.id)} 38% 46%))` }}
                onClick={() => setSelected(t)}
                aria-label={t.title}
              >
                <span>{t.title}</span>
              </button>
            ))}
          </div>

          <div className="lbx-scroller">
            <table className="lbx-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Call no.</th>
                  <th>ISBN</th>
                  <th>Year</th>
                </tr>
              </thead>
              <tbody>
                {state.hits.map((t) => (
                  <tr key={t.id} onClick={() => setSelected(t)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="lbx-ttl">{t.title}</div>
                      {t.subtitle ? <div className="lbx-au">{t.subtitle}</div> : null}
                      {t.publisher ? <div className="lbx-au">{t.publisher}</div> : null}
                    </td>
                    <td className="lbx-mono">{t.callNumber ?? '—'}</td>
                    <td className="lbx-mono">{t.isbn13 ?? t.isbn10 ?? '—'}</td>
                    <td className="lbx-mono">{t.publishedYear ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--lb-ink-3)', fontSize: '.78rem', marginTop: '.6rem' }}>
            {state.hits.length} shown{state.hits.length >= 60 ? ' (first 60 — narrow the search for more)' : ''}
          </p>
        </>
      ) : null}

      {selected ? (
        <aside className="lbx-detail" aria-label={`Details for ${selected.title}`}>
          <div className="lbx-detail-head">
            <h3>{selected.title}</h3>
            <button className="lbx-btn ghost" onClick={() => setSelected(null)}>Close</button>
          </div>
          {selected.subtitle ? <p className="lbx-au">{selected.subtitle}</p> : null}
          <dl className="lbx-dl">
            <dt>Call number</dt><dd className="lbx-mono">{selected.callNumber ?? '—'}</dd>
            <dt>ISBN</dt><dd className="lbx-mono">{selected.isbn13 ?? selected.isbn10 ?? '—'}</dd>
            <dt>Publisher</dt><dd>{selected.publisher ?? '—'}</dd>
            <dt>Published</dt><dd>{selected.publishedYear ?? '—'}</dd>
            <dt>Edition</dt><dd>{selected.edition ?? '—'}</dd>
            <dt>Language</dt><dd>{selected.language}</dd>
            <dt>Pages</dt><dd>{selected.pageCount ?? '—'}</dd>
          </dl>
          {selected.description ? <p style={{ fontSize: '.88rem' }}>{selected.description}</p> : null}
        </aside>
      ) : null}
    </>
  );
}
