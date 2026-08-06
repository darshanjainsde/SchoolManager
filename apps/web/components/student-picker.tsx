'use client';
import { useMemo, useState } from 'react';

export interface PickableStudent {
  id: string;
  name: string;
  rollNo?: string | null;
}

const fieldCls =
  'w-full rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)]';

/**
 * Type a name → pick the match → it becomes a removable chip. The web twin of
 * the app's `StudentPicker` (apps/mobile/src/components/StudentPicker.tsx),
 * deliberately the same interaction rather than a desktop-only multi-select:
 * a teacher who learns it on one surface should not have to relearn it on the
 * other, and typing three letters beats scanning a hundred checkboxes on any
 * screen size.
 *
 * Keyboard: ↓/↑ move through matches, Enter picks the highlighted one,
 * Backspace on an empty field removes the last chip — the conventions a
 * to-field has had since email clients, so nobody has to be taught them.
 */
/**
 * How a pupil is named where it MATTERS THAT THEY ARE NOT SOMEBODY ELSE.
 *
 * Two children can share a name exactly. Anywhere a teacher confirms an action
 * against a specific pupil — a chip they are about to send a remark to, a
 * control they are about to remove — the roll number goes with the name.
 */
export function labelFor(student?: { name: string; rollNo?: string | null }): string {
  if (!student) return 'student';
  return student.rollNo ? `${student.name}, roll ${student.rollNo}` : student.name;
}

export function StudentPicker({
  students,
  selected,
  onChange,
  placeholder = 'Type a name…',
  inputId,
}: {
  students: PickableStudent[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  inputId?: string;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => !selected.includes(s.id))
      .filter((s) => s.name.toLowerCase().includes(q) || (s.rollNo ?? '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, students, selected]);

  function add(id: string) {
    setQuery('');
    setCursor(0);
    if (!selected.includes(id)) onChange([...selected, id]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      onChange(selected.slice(0, -1));
      return;
    }
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      add(matches[Math.min(cursor, matches.length - 1)].id);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="picker-tokens">
          {selected.map((id) => (
            // `sk-tokin` pops the chip in as it is created. Keyed on the
            // student id, so React mounts a fresh node per pick and the
            // animation runs for the NEW token only — re-rendering the list
            // (e.g. after typing another letter) must not re-pop the ones
            // already there.
            <button
              key={id}
              type="button"
              data-testid={`token-${id}`}
              onClick={() => onChange(selected.filter((x) => x !== id))}
              className="sk-tok sk-tokin sk-press"
              aria-label={`Remove ${labelFor(byId.get(id))}`}
            >
              {byId.get(id)?.name ?? 'Student'}
              {/* TWO CHILDREN CAN SHARE A NAME EXACTLY. The dropdown always
                  showed the roll number, but once picked a chip showed the name
                  alone — so two pupils called the same thing became two
                  identical chips and the teacher could not tell which remark
                  was going to which child. The roll rides along on the chip. */}
              {byId.get(id)?.rollNo ? <span className="rl">{byId.get(id)?.rollNo}</span> : null}
              <span className="x" aria-hidden="true">
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          id={inputId}
          data-testid="picker-input"
          className={fieldCls}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        {matches.length > 0 && (
          <ul data-testid="picker-matches" className="sk-drop">
            {matches.map((s, i) => (
              <li key={s.id}>
                {/* `data-cursor` rather than an inline background so the
                    keyboard cursor and the mouse hover are painted by the same
                    rule — they drifted apart when one lived in CSS and the
                    other in a style prop. */}
                <button
                  type="button"
                  data-testid={`match-${s.id}`}
                  data-cursor={i === cursor ? 'true' : undefined}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => add(s.id)}
                  className="sk-dropit"
                >
                  <span>{s.name}</span>
                  {/* Roll numbers right-aligned in mono: a column of digits you
                      scan down, matching the register's treatment. */}
                  {s.rollNo ? <span className="rl">{`Roll ${s.rollNo}`}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {query.trim() !== '' && matches.length === 0 && (
        <p className="sk-state" data-testid="picker-empty">
          No one in this class matches “{query.trim()}”.
        </p>
      )}
    </div>
  );
}
