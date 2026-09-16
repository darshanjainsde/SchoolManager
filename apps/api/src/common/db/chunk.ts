/**
 * Split rows into statement-sized batches.
 *
 * `createMany` is one round trip however many rows it carries, which is the
 * whole point of using it — but a single INSERT with twenty thousand rows is a
 * very large statement to build, send and parse, and it is the kind of thing
 * that works in testing and surprises somebody at the roster ceiling.
 *
 * A thousand keeps each statement small while still turning O(rows) round trips
 * into O(rows / 1000). For a 1,500-child school that is two statements instead
 * of fifteen hundred.
 */
export const DB_BATCH = 1_000;

export function chunk<T>(rows: readonly T[], size: number = DB_BATCH): T[][] {
  if (size < 1) throw new Error('chunk: size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** `createMany` in batches, returning the total written. */
export async function createInBatches<T>(
  rows: readonly T[],
  createMany: (data: T[]) => Promise<{ count: number }>,
  size: number = DB_BATCH,
): Promise<number> {
  let total = 0;
  for (const part of chunk(rows, size)) total += (await createMany(part)).count;
  return total;
}
