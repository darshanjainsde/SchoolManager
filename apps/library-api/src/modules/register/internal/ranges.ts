/**
 * Parses what a librarian types while walking the shelves.
 *
 * Accession numbers run in sequence per library, and that is load-bearing
 * rather than tidy: it is the ONLY thing that makes a scanner-free stock take
 * typeable. A shelf of six books is one entry — `1001-1006` — instead of six.
 * Without sequential numbering the annual stock take is six thousand
 * keystrokes and nobody does it.
 *
 * Accepts a mixture, separated by commas, spaces or newlines:
 *   `1001-1006`   an inclusive range
 *   `1009`        a single number
 *   `ACC-00042`   a legacy prefixed number, single only
 *
 * A prefixed number cannot be ranged, deliberately: `ACC-1..ACC-9` looks
 * obvious but a school with `A-1`, `A-10`, `A-2` has a string ordering that is
 * not numeric, and quietly guessing which one they meant is how a stock take
 * silently marks the wrong books present.
 */
export interface ParsedRanges {
  /** Every accession number named, expanded and de-duplicated. */
  numbers: string[];
  /** Entries that could not be understood, verbatim, so the librarian can see
   *  exactly what to retype rather than being told "invalid input". */
  unparsed: string[];
}

/** A range wider than this is almost certainly a typo (`1001-100600`), and
 *  expanding it would hang the request rather than fail it. */
const MAX_RANGE_SPAN = 5_000;

export function parseAccessionRanges(input: string): ParsedRanges {
  const numbers = new Set<string>();
  const unparsed: string[] = [];

  for (const rawEntry of input.split(/[\s,]+/)) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const range = entry.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      // Accept either direction: someone reading a shelf right-to-left types
      // it the way they read it.
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      if (hi - lo > MAX_RANGE_SPAN) {
        unparsed.push(entry);
        continue;
      }
      // Zero-padding is preserved from the LEFT operand, so a library whose
      // numbers read `0001` gets `0001-0006` expanded in its own form rather
      // than silently renumbered to `1`.
      const width = range[1].length;
      for (let n = lo; n <= hi; n++) numbers.add(String(n).padStart(width, '0'));
      continue;
    }

    if (/^[\w./-]+$/.test(entry)) {
      numbers.add(entry);
      continue;
    }
    unparsed.push(entry);
  }

  return { numbers: [...numbers], unparsed };
}
