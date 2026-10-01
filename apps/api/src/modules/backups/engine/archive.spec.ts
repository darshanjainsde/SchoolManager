import { randomBytes } from 'node:crypto';
import { ArchiveReader, ArchiveWriter, MemorySink, MemorySource } from './archive';
import { ArchiveError, CHUNK_BYTES, FOOTER_BYTES, MAGIC, encodeHeader, decodeHeader } from './container';

// scrypt at full strength costs ~60 ms; the format is identical at N=1024.
const KDF = { N: 1024, r: 8, p: 1 };
const PW = 'correct horse battery staple';

async function build(entries: [string, Buffer][], manifest: Record<string, unknown> = { hello: 'school' }) {
  const sink = new MemorySink();
  const w = await ArchiveWriter.create(sink, PW, KDF);
  for (const [n, d] of entries) await w.add(n, d);
  await w.finish(manifest);
  return sink.buffer();
}
const open = (buf: Buffer, pw = PW) => ArchiveReader.open(new MemorySource(buf), pw);
const code = async (p: Promise<unknown>) => {
  try { await p; return 'OK'; } catch (e) { return e instanceof ArchiveError ? e.code : `THREW ${(e as Error).message}`; }
};

describe('a .sckools archive round-trips every entry exactly', () => {
  it('at the sizes where chunking goes wrong: empty, one byte, a full chunk, a chunk and one, several chunks', async () => {
    const entries: [string, Buffer][] = [
      ['empty', Buffer.alloc(0)],
      ['one', Buffer.from('x')],
      ['exact', randomBytes(CHUNK_BYTES)],
      ['plus-one', randomBytes(CHUNK_BYTES + 1)],
      ['three-and-a-bit', randomBytes(CHUNK_BYTES * 3 + 17)],
      ['unicode/नाम.json', Buffer.from('{"name":"Sant Nischal Singh — लाडवा"}')],
    ];
    const r = await open(await build(entries, { school: 'snsps' }));
    expect(r.manifest).toEqual({ school: 'snsps' });
    for (const [n, d] of entries) expect((await r.read(n)).equals(d)).toBe(true);
    expect(r.entry('exact')!.chunks).toBe(1);
    expect(r.entry('plus-one')!.chunks).toBe(2);
    expect(r.entry('empty')!.chunks).toBe(1);
  });

  it('lists entries by prefix in the order they were written', async () => {
    const r = await open(await build([['rows/A/0', Buffer.from('a')], ['files/x', Buffer.from('f')], ['rows/B/0', Buffer.from('b')]]));
    expect(r.entries('rows/').map((e) => e.name)).toEqual(['rows/A/0', 'rows/B/0']);
  });

  it('refuses two entries with the same name instead of hiding one', async () => {
    const w = await ArchiveWriter.create(new MemorySink(), PW, KDF);
    await w.add('a', Buffer.from('1'));
    await expect(w.add('a', Buffer.from('2'))).rejects.toThrow(/already has an entry/);
  });

  it('accepts the same password typed with a different Unicode composition', async () => {
    const buf = await (async () => {
      const sink = new MemorySink();
      const w = await ArchiveWriter.create(sink, 'café', KDF); // é as one code point
      await w.add('a', Buffer.from('1'));
      await w.finish({});
      return sink.buffer();
    })();
    expect(await code(open(buf, 'café'))).toBe('OK'); // e + combining accent
  });
});

describe('a backup written in steps is the same backup', () => {
  it('resumes from saved state in a "new process" and stays readable end to end', async () => {
    const sink = new MemorySink();
    const w1 = await ArchiveWriter.create(sink, PW, KDF);
    await w1.add('step1', Buffer.from('first'));
    const saved = JSON.parse(JSON.stringify(w1.state())); // survives a DB round trip
    const w2 = ArchiveWriter.resume(sink, PW, saved);
    await w2.add('step2', randomBytes(CHUNK_BYTES + 5));
    const w3 = ArchiveWriter.resume(sink, PW, JSON.parse(JSON.stringify(w2.state())));
    await w3.finish({ steps: 3 });
    const r = await open(sink.buffer());
    expect((await r.read('step1')).toString()).toBe('first');
    expect(r.entry('step2')!.size).toBe(CHUNK_BYTES + 5);
    expect(r.manifest).toEqual({ steps: 3 });
  });

  it('will not resume with a different password — it would write chunks no one can read', async () => {
    const w = await ArchiveWriter.create(new MemorySink(), PW, KDF);
    expect(() => ArchiveWriter.resume(new MemorySink(), 'other', w.state())).toThrow(/not the one/);
  });
});

describe('a backup that is wrong, damaged or cut short is refused — never half-read', () => {
  let good: Buffer;
  beforeAll(async () => {
    good = await build([['a', randomBytes(5000)], ['b', randomBytes(5000)], ['c', Buffer.from('tail')]]);
  });

  it('wrong password: told as a password problem, not as damage', async () => {
    expect(await code(open(good, 'nope'))).toBe('WRONG_PASSWORD');
    expect(await code(open(good, ''))).toBe('WRONG_PASSWORD');
  });

  it('not a backup at all', async () => {
    expect(await code(open(randomBytes(4096)))).toBe('BAD_FORMAT');
    expect(await code(open(Buffer.from('PK\x03\x04 a zip file')))).toBe('BAD_FORMAT');
    expect(await code(open(Buffer.alloc(0)))).toBe('BAD_FORMAT');
  });

  it('cut short anywhere — mid-data, inside the index, or missing only the footer', async () => {
    for (const cut of [1, 7, FOOTER_BYTES, FOOTER_BYTES + 3, Math.floor(good.length / 2)]) {
      expect(await code(open(good.subarray(0, good.length - cut)))).toBe('DAMAGED');
    }
  });

  it('one flipped bit in a data chunk: the index still opens, that entry is refused, the others still read', async () => {
    const r0 = await open(good);
    const bad = Buffer.from(good);
    bad[r0.entry('b')!.offset + 20] ^= 0x01;
    const r = await open(bad);
    expect(await code(r.read('b'))).toBe('DAMAGED');
    expect((await r.read('a')).length).toBe(5000);
    expect((await r.read('c')).toString()).toBe('tail');
  });

  it('one flipped bit in the index refuses the whole file', async () => {
    const bad = Buffer.from(good);
    bad[good.length - FOOTER_BYTES - 5] ^= 0x80;
    expect(await code(open(bad))).toBe('DAMAGED');
  });

  it('two entries of equal size swapped in place: each fails, because a chunk knows its position', async () => {
    const r0 = await open(good);
    const a = r0.entry('a')!; const b = r0.entry('b')!;
    expect(a.sealedBytes).toBe(b.sealedBytes);
    const bad = Buffer.from(good);
    good.copy(bad, a.offset, b.offset, b.offset + b.sealedBytes);
    good.copy(bad, b.offset, a.offset, a.offset + a.sealedBytes);
    const r = await open(bad);
    expect(await code(r.read('a'))).toBe('DAMAGED');
    expect(await code(r.read('b'))).toBe('DAMAGED');
  });

  it('a header swapped in from another backup (same password) fails every chunk', async () => {
    const other = await build([['a', randomBytes(5000)], ['b', randomBytes(5000)], ['c', Buffer.from('tail')]]);
    const goodHead = decodeHeader(good).bytes.length;
    const otherHead = decodeHeader(other).bytes;
    expect(otherHead.length).toBe(goodHead);
    const spliced = Buffer.concat([otherHead, good.subarray(goodHead)]);
    expect(await code(open(spliced))).toBe('DAMAGED');
  });

  it('a backup from a newer format is refused with "update the code", not as damage', async () => {
    const { header } = decodeHeader(good);
    const newer = Buffer.concat([encodeHeader({ ...header, format: 99 }), good.subarray(decodeHeader(good).bytes.length)]);
    expect(await code(open(newer))).toBe('TOO_NEW');
  });

  it('starts with the published magic bytes, so the file type is recognisable', () => {
    expect(good.subarray(0, MAGIC.length).equals(MAGIC)).toBe(true);
  });
});
