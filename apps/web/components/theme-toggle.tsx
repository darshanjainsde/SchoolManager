'use client';
import { useEffect, useState } from 'react';
import { THEME_SCRIPT } from '@/lib/theme-script';

type Choice = 'light' | 'dark' | 'system';
const KEY = 'sk-theme';

/** Applies the choice to <html>; 'system' removes the attribute so the CSS media query rules. */
function apply(choice: Choice): void {
  const el = document.documentElement;
  if (choice === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', choice);
}

/**
 * Light / dark / system switch. The choice is stored per browser and applied to
 * <html data-theme>, which the theme's token overrides key off — so an explicit
 * choice beats the OS preference in both directions.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>('system');

  // Read the stored choice after mount — server and first client paint must match.
  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as Choice | null) ?? 'system';
    setChoice(stored);
    apply(stored);
  }, []);

  function pick(next: Choice) {
    setChoice(next);
    localStorage.setItem(KEY, next);
    apply(next);
  }

  const options: { value: Choice; icon: string; label: string }[] = [
    { value: 'light', icon: '☀', label: 'Light theme' },
    { value: 'dark', icon: '☾', label: 'Dark theme' },
    { value: 'system', icon: '◐', label: 'Match system theme' },
  ];

  return (
    <div className="sk-themetoggle" role="group" aria-label="Theme">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          aria-pressed={choice === o.value}
          aria-label={o.label}
          title={o.label}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

/**
 * Applies the stored theme before first paint so a dark-theme user never sees a
 * white flash. Rendered in the app shell; runs ahead of hydration.
 */
export function ThemeScript() {
  // Source lives in lib/theme-script so the CSP hash is derived from the same
  // string the browser executes — see the warning there before editing it.
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
