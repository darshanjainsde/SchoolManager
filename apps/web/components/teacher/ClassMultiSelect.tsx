'use client';
import type { MyClassSection } from '@skoolos/types';

export interface ClassMultiSelectProps {
  /** Already filtered to owned-only by the caller — see `page.tsx`'s `covering` filter. */
  classes: MyClassSection[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select chips for "which class(es)" — the web counterpart of the
 * mobile app's `ClassChips`. Real `<button>`s with `aria-pressed`, not a
 * `<select multiple>`: keyboard reachable, and a tap target that actually
 * works on touch.
 *
 * Renders (props only, no fetching) — the page owns the `GET
 * /manage/attendance/my-classes` query and the `covering` exclusion.
 */
export function ClassMultiSelect({
  classes,
  selected,
  onChange,
  disabled = false,
}: ClassMultiSelectProps): React.JSX.Element {
  if (classes.length === 0) {
    return <p className="sk-state">No classes to choose from.</p>;
  }

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div>
      <p className="sk-muted" style={{ marginBottom: 8 }}>
        {selected.length} of {classes.length} selected
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {classes.map((c) => {
          const on = selected.includes(c.classSectionId);
          return (
            <button
              key={c.classSectionId}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(c.classSectionId)}
              className="sk-chip"
              data-selected={on}
            >
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
