import { useRef } from 'react';

/**
 * Stable React keys for an array of plain-object blocks that carries no id of
 * its own.
 *
 * Index keys break reordering: React ties the DOM node (and therefore focus,
 * caret position and scroll) to the *slot*, so moving a block up leaves the
 * cursor behind in the block that took its place. Persisting an id into the
 * block would leak editor bookkeeping into the stored JSONB content, so the
 * keys live next to the list that mutates instead.
 *
 * Call the mutators alongside the corresponding change to the block array.
 */
export function useBlockKeys(length: number) {
  const keys = useRef<string[]>([]);
  const seq = useRef(0);

  // Re-sync when the array is replaced from outside (loading another post).
  while (keys.current.length < length) keys.current.push(`b${seq.current++}`);
  if (keys.current.length > length) keys.current.length = length;

  return {
    keys: keys.current,
    /** Call before appending/inserting a block at `at`. */
    insert(at: number): void {
      keys.current.splice(at, 0, `b${seq.current++}`);
    },
    /** Call before removing the block at `at`. */
    remove(at: number): void {
      keys.current.splice(at, 1);
    },
    /** Call before swapping the blocks at `a` and `b`. */
    swap(a: number, b: number): void {
      [keys.current[a], keys.current[b]] = [keys.current[b], keys.current[a]];
    },
  };
}
