'use client';
import { useMemo, useState } from 'react';
import { SPORTS, sportsByGroup, type Sport } from '@skoolos/types';
import { SportDiagram } from '@/components/sports/diagrams';
import { Pill, useDebounced } from './ui';

/**
 * The rules book: every sport in the catalogue, grouped, with the official
 * rules in plain words and a drawing where a drawing says it faster. Ships
 * with the app — no request, works the same for a teacher on the field.
 */
export default function RulesTab({ base: _base }: { base: string }) {
  const [key, setKey] = useState<string>(SPORTS[0].key);
  const [q, setQ] = useState('');
  const query = useDebounced(q).trim().toLowerCase();
  const groups = useMemo(() => sportsByGroup().map((g) => ({ ...g, sports: query ? g.sports.filter((s) => s.name.toLowerCase().includes(query) || s.group.toLowerCase().includes(query)) : g.sports })).filter((g) => g.sports.length), [query]);
  const sport = SPORTS.find((s) => s.key === key) ?? SPORTS[0];
  return (
    <div className="sk-sp-rules">
      <nav className="sk-sp-rail" aria-label="Sports">
        <input className="sk-input" placeholder="Find a sport…" aria-label="Find a sport" value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.map((g) => (
          <div key={g.group} style={{ display: 'contents' }}>
            <span className="sk-lab">{g.group}</span>
            {g.sports.map((s) => <button key={s.key} type="button" aria-pressed={s.key === sport.key} onClick={() => setKey(s.key)}>{s.name}</button>)}
          </div>
        ))}
        {groups.length === 0 ? <p className="sk-state">No sport by that name.</p> : null}
      </nav>
      <Article sport={sport} />
    </div>
  );
}

function scoringFacts(s: Sport): string[] {
  const sc = s.scoring;
  if (sc.type === 'GAMES') return [`Best of ${sc.bestOf} ${sc.label.toLowerCase()}`, `To ${sc.to}, win by ${sc.winBy}${sc.cap ? `, cap ${sc.cap}` : ''}${sc.finalTo ? `, decider to ${sc.finalTo}` : ''}`];
  if (sc.type === 'SINGLE') return [`${sc.label} decide`, `Level: ${sc.decider.toLowerCase()}`];
  return [`${sc.label} in ${sc.unit === 's' ? 'seconds' : sc.unit === 'm' ? 'metres' : sc.unit}`, sc.lowerIsBetter ? 'Lower is better' : 'Higher is better', `${s.lanes ?? 6} per heat`];
}

export function Article({ sport }: { sport: Sport }) {
  return (
    <article className="sk-sp-article" aria-labelledby="sport-title">
      <div>
        <p className="sk-lab">{sport.group}</p>
        <h2 id="sport-title">{sport.name}</h2>
      </div>
      <div className="sk-sp-facts">
        <Pill tone="brand">{sport.kind === 'MATCH' ? (sport.teamSize > 1 ? `Team of ${sport.teamSize}` : 'Head to head') : sport.kind === 'MEASURED' ? 'Measured' : 'Judged'}</Pill>
        {scoringFacts(sport).map((f) => <Pill key={f} tone="muted">{f}</Pill>)}
        <Pill tone="muted">{sport.slotMin} min a {sport.kind === 'MATCH' ? 'match' : 'round'}</Pill>
        <Pill tone="muted">{sport.venue}</Pill>
        {sport.olympic ? <Pill tone="good">Olympic</Pill> : null}
      </div>
      <p className="sum">{sport.rules.summary}</p>
      {sport.rules.diagram ? <SportDiagram diagram={sport.rules.diagram} /> : null}
      {sport.rules.sections.map((sec) => (
        <section key={sec.title}>
          <h4>{sec.title}</h4>
          <ul>{sec.points.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      ))}
    </article>
  );
}
