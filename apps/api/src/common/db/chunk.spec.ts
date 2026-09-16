import { chunk, createInBatches, DB_BATCH } from './chunk';

describe('chunk', () => {
  it('splits to the batch size and keeps order and every row', () => {
    const rows = Array.from({ length: 2_500 }, (_, i) => i);
    const parts = chunk(rows);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 500]);
    expect(parts.flat()).toEqual(rows);
  });
  it('an empty list is no batches — never one empty statement', () => {
    expect(chunk([])).toEqual([]);
  });
  it('a short list is one batch', () => {
    expect(chunk([1, 2, 3])).toEqual([[1, 2, 3]]);
  });
  it('refuses a nonsense size rather than looping for ever', () => {
    expect(() => chunk([1], 0)).toThrow('size must be >= 1');
  });
  it('createInBatches issues one call per batch and sums what was written', async () => {
    const calls: number[] = [];
    const total = await createInBatches(
      Array.from({ length: 2_100 }, (_, i) => i),
      async (data) => { calls.push(data.length); return { count: data.length }; },
    );
    expect(calls).toEqual([1000, 1000, 100]);
    expect(total).toBe(2_100);
  });
  it('writes nothing, and calls nothing, for an empty list', async () => {
    const createMany = jest.fn();
    expect(await createInBatches([], createMany)).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
  it('DB_BATCH is the documented default', () => {
    expect(DB_BATCH).toBe(1_000);
  });
});
