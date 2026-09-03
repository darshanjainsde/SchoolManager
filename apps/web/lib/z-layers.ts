/**
 * The console's stacking ladder — one place, because two numbers chosen a week
 * apart is how a modal ends up underneath a search box.
 *
 * That is not hypothetical: the dashboard's command bar was given `zIndex: 60`
 * to lift its dropdown clear of the Morning Bell, and every modal still sat at
 * Tailwind's `z-50` — so "Record a payment" opened UNDER the search field.
 * A reader of either file could not have seen the conflict; only the ladder
 * shows it.
 *
 * Read it top to bottom as "what must be able to cover what":
 *
 *   PAGE_CHROME  a page-level control whose own popover must clear the cards
 *                around it (the command bar and its results).
 *   OVERLAY      anything modal: drawers, dialogs, confirmations. Above all
 *                page chrome, because a modal owns the screen while it is open.
 *   VIEWER       the Print Room — a full-screen reader that can be opened FROM
 *                a drawer, so it has to cover one.
 *   TOAST        notifications, which must be readable above everything,
 *                including a viewer (sonner is mounted at the app root).
 */
export const Z = {
  PAGE_CHROME: 60,
  OVERLAY: 80,
  VIEWER: 90,
  TOAST: 100,
} as const;
