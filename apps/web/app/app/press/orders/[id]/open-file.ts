/**
 * Opening a signed, short-lived link in a new tab, without losing it.
 *
 * Two browser behaviours fight each other here:
 *
 *  - A popup blocker only permits `window.open` while a user gesture is still
 *    on the stack, so the tab must be reserved during the click — before the
 *    request that fetches the link is awaited.
 *  - `noopener` makes `window.open` return `null`. That is the flag working as
 *    specified, not a bug, but it means a tab reserved with `noopener` cannot
 *    be navigated afterwards: the handle is gone and the blank tab is orphaned.
 *
 * So we reserve without `noopener` and clear `opener` ourselves the moment we
 * have somewhere to go, which leaves the new page with no reference back.
 */

/** The slice of `Window` this module touches — enough to fake in a test. */
export type OpenedTab = {
  closed: boolean;
  opener: unknown;
  location: { replace: (url: string) => void };
  close: () => void;
};

export type OpenWindow = (url: string, target: string, features?: string) => OpenedTab | null;

/** Reserve the tab during the click. Deliberately no feature string. */
export function reserveTab(open: OpenWindow): OpenedTab | null {
  return open('', '_blank');
}

/**
 * Send the reserved tab to `url`. If it never opened, or the user closed it
 * while the request was in flight, fall back to a direct open — that one may
 * be blocked, but a blocked popup beats navigating nothing.
 */
export function sendTabTo(tab: OpenedTab | null | undefined, url: string, open: OpenWindow): void {
  if (tab && !tab.closed) {
    tab.opener = null;
    // `replace`, not an href assignment: the blank placeholder should not sit
    // in history behind the document, where Back would land on it.
    tab.location.replace(url);
    return;
  }
  open(url, '_blank', 'noopener,noreferrer');
}

/**
 * The request failed, so nothing is coming. Close the tab we reserved rather
 * than leaving the reader staring at a blank page with no explanation — the
 * error belongs on the page they clicked from, where they can see it.
 */
export function dropTab(tab: OpenedTab | null | undefined): void {
  if (tab && !tab.closed) tab.close();
}
