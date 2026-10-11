import type { ReactNode } from 'react';

/**
 * One settings section: its name and a line of explanation on the left, the
 * controls in one card on the right (stacked on a phone). One column of these
 * per tab — never a card grid, which stretched short cards to their
 * neighbour's height (UI ledger: unrelated-cards-in-a-stretching-grid).
 * Anything inside that can grow (a log, a list of wording) opens behind a
 * button in an Overlay instead of growing the page.
 */
export function SettingsSection({ title, hint, children, testId, aside }: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Small status beside the title, e.g. an On/Off pill. */
  aside?: ReactNode;
}) {
  return (
    <section className="sk-setsec" data-testid={testId} aria-label={title}>
      <div className="sk-setsec-lab">
        <h2>
          {title}
          {aside ? <span className="sk-setsec-aside">{aside}</span> : null}
        </h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      <div className="sk-setsec-body">{children}</div>
    </section>
  );
}

/** The card a section's controls sit in. */
export function SettingsCard({ children, testId, flush }: { children: ReactNode; testId?: string; flush?: boolean }) {
  return (
    <div className="sk-setcard" data-flush={flush || undefined} data-testid={testId}>
      {children}
    </div>
  );
}

/** A row of actions at the foot of a card, right-aligned. */
export function SettingsActions({ children }: { children: ReactNode }) {
  return <div className="sk-setbar">{children}</div>;
}
