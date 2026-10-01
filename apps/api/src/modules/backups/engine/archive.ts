import {
  ArchiveError, CHUNK_BYTES, FOOTER_BYTES, Header, MAX_TRAILER_BYTES,
  decodeFooter, decodeHeader, encodeFooter, encodeHeader, headerAad, newHeader, openChunk, sealChunk, sha256, unlock, deriveKey,
} from './container';

/** Where sealed bytes go. Implementations: memory (tests), a local file (CLI), S3 multipart (server). */
export interface Sink {
  append(bytes: Buffer): Promise<void>;
  /** Persist whatever is buffered so the job can stop here and resume in another process. */
  checkpoint(): Promise<unknown>;
  /** Seal the object. Returns its final size in bytes. */
  finish(): Promise<number>;
}

/** Random-access reads over a finished archive. */
export interface Source {
  size(): Promise<number>;
  read(offset: number, length: number): Promise<Buffer>;
}

export interface IndexEntry {
  name: string;
  /** Byte offset of the entry's first chunk (its length prefix). */
  offset: number;
  /** Counter of the first chunk; the entry's chunks are counter … counter+chunks-1. */
  counter: number;
  chunks: number;
  /** Bytes the entry occupies in the file, prefixes included. */
  sealedBytes: number;
  /** Plaintext size and digest, re-checked on every read. */
  size: number;
  sha256: string;
  meta?: Record<string, unknown>;
}

export interface Trailer<M = Record<string, unknown>> {
  format: number;
  index: IndexEntry[];
  manifest: M;
}

/** Everything needed to resume writing in another process. JSON-safe. */
export interface WriterState {
  header: Header;
  counter: number;
  offset: number;
  index: IndexEntry[];
}

export class ArchiveWriter {
  private constructor(
    private readonly sink: Sink,
    private readonly key: Buffer,
    private readonly aad: Buffer,
    private st: WriterState,
  ) {}

  /** Starts a new archive and writes its header. */
  static async create(sink: Sink, password: string, kdf?: { N: number; r: number; p: number }): Promise<ArchiveWriter> {
    const { header, key } = newHeader(password, kdf);
    const headerBytes = encodeHeader(header);
    await sink.append(headerBytes);
    return new ArchiveWriter(sink, key, headerAad(headerBytes), { header, counter: 0, offset: headerBytes.length, index: [] });
  }

  /** Picks up an archive another step started. The sink must already be positioned at `state.offset`. */
  static resume(sink: Sink, password: string, state: WriterState): ArchiveWriter {
    const key = deriveKey(password, state.header.kdf);
    unlock(state.header, password); // proves the password before writing one more byte
    return new ArchiveWriter(sink, key, headerAad(encodeHeader(state.header)), structuredClone(state));
  }

  state(): WriterState {
    return structuredClone(this.st);
  }

  has(name: string): boolean {
    return this.st.index.some((e) => e.name === name);
  }

  /**
   * Adds one entry. Each entry starts on a fresh chunk, so a reader can seek
   * straight to it and a step can stop between any two entries.
   */
  async add(name: string, data: Buffer, meta?: Record<string, unknown>): Promise<IndexEntry> {
    if (this.has(name)) throw new Error(`archive already has an entry named ${name}`);
    const entry: IndexEntry = {
      name, offset: this.st.offset, counter: this.st.counter, chunks: 0, sealedBytes: 0,
      size: data.length, sha256: sha256(data), ...(meta ? { meta } : {}),
    };
    // An empty entry still takes one (empty) chunk, so its position is real.
    let pos = 0;
    do {
      const plain = data.subarray(pos, pos + CHUNK_BYTES);
      const sealed = sealChunk(this.key, this.st.header, this.aad, this.st.counter, plain, false);
      await this.sink.append(sealed);
      this.st.counter += 1;
      this.st.offset += sealed.length;
      entry.chunks += 1;
      entry.sealedBytes += sealed.length;
      pos += CHUNK_BYTES;
    } while (pos < data.length);
    this.st.index.push(entry);
    return entry;
  }

  async checkpoint(): Promise<unknown> {
    return this.sink.checkpoint();
  }

  /** Seals the trailer as the FINAL chunk, writes the footer and closes the sink. */
  async finish(manifest: Record<string, unknown>): Promise<{ bytes: number; trailer: Trailer }> {
    const trailer: Trailer = { format: this.st.header.format, index: this.st.index, manifest };
    const plain = Buffer.from(JSON.stringify(trailer), 'utf8');
    if (plain.length > MAX_TRAILER_BYTES) throw new Error('archive index is too large');
    const trailerOffset = this.st.offset;
    const trailerCounter = this.st.counter;
    const sealed = sealChunk(this.key, this.st.header, this.aad, trailerCounter, plain, true);
    await this.sink.append(sealed);
    await this.sink.append(encodeFooter(trailerOffset, trailerCounter));
    this.st.counter += 1;
    this.st.offset += sealed.length + FOOTER_BYTES;
    const bytes = await this.sink.finish();
    return { bytes, trailer };
  }
}

export class ArchiveReader<M = Record<string, unknown>> {
  private constructor(
    private readonly source: Source,
    private readonly key: Buffer,
    private readonly header: Header,
    private readonly aad: Buffer,
    readonly trailer: Trailer<M>,
    readonly bytes: number,
  ) {}

  /**
   * Opens and AUTHENTICATES an archive: header, password, footer, trailer.
   * A file that is cut short, damaged anywhere in its index, or locked with a
   * different password fails here — before an import writes a single row.
   */
  static async open<M = Record<string, unknown>>(source: Source, password: string): Promise<ArchiveReader<M>> {
    const size = await source.size();
    if (size < FOOTER_BYTES + 12) throw new ArchiveError('BAD_FORMAT', 'This is not a Sckools backup file (it is too small).');
    const head = await source.read(0, Math.min(size, 64 * 1024 + 12));
    const { header, bytes: headerBytes } = decodeHeader(head);
    const key = unlock(header, password);
    const aad = headerAad(headerBytes);

    const { trailerOffset, trailerCounter } = decodeFooter(await source.read(size - FOOTER_BYTES, FOOTER_BYTES));
    if (trailerOffset < headerBytes.length || trailerOffset + 4 > size - FOOTER_BYTES) {
      throw new ArchiveError('DAMAGED', 'The backup file is damaged (its index points outside the file).');
    }
    const lenBuf = await source.read(trailerOffset, 4);
    const len = lenBuf.readUInt32BE(0);
    if (len > MAX_TRAILER_BYTES + 16 || trailerOffset + 4 + len !== size - FOOTER_BYTES) {
      throw new ArchiveError('DAMAGED', 'The backup file is damaged (its index has the wrong length).');
    }
    const plain = openChunk(key, header, aad, trailerCounter, await source.read(trailerOffset + 4, len), true);
    let trailer: Trailer<M>;
    try {
      trailer = JSON.parse(plain.toString('utf8'));
    } catch {
      throw new ArchiveError('DAMAGED', 'The backup file is damaged (its index is unreadable).');
    }
    if (!Array.isArray(trailer.index)) throw new ArchiveError('DAMAGED', 'The backup file has no index.');
    return new ArchiveReader<M>(source, key, header, aad, trailer, size);
  }

  get manifest(): M {
    return this.trailer.manifest;
  }

  entries(prefix = ''): IndexEntry[] {
    return this.trailer.index.filter((e) => e.name.startsWith(prefix));
  }

  entry(name: string): IndexEntry | undefined {
    return this.trailer.index.find((e) => e.name === name);
  }

  /** Reads, decrypts and digest-checks one entry. */
  async read(e: IndexEntry | string): Promise<Buffer> {
    const entry = typeof e === 'string' ? this.entry(e) : e;
    if (!entry) throw new ArchiveError('DAMAGED', `The backup file has no entry ${String(e)}.`);
    const raw = await this.source.read(entry.offset, entry.sealedBytes);
    if (raw.length !== entry.sealedBytes) throw new ArchiveError('DAMAGED', `The backup file is cut short inside ${entry.name}.`);
    const parts: Buffer[] = [];
    let pos = 0;
    for (let i = 0; i < entry.chunks; i += 1) {
      if (pos + 4 > raw.length) throw new ArchiveError('DAMAGED', `The backup file is damaged inside ${entry.name}.`);
      const len = raw.readUInt32BE(pos);
      const body = raw.subarray(pos + 4, pos + 4 + len);
      if (body.length !== len) throw new ArchiveError('DAMAGED', `The backup file is damaged inside ${entry.name}.`);
      parts.push(openChunk(this.key, this.header, this.aad, entry.counter + i, body, false));
      pos += 4 + len;
    }
    const data = Buffer.concat(parts);
    if (data.length !== entry.size || sha256(data) !== entry.sha256) {
      throw new ArchiveError('DAMAGED', `The backup file is damaged inside ${entry.name} (checksum mismatch).`);
    }
    return data;
  }
}

/* ── Simple sinks and sources ───────────────────────────────────────────── */

export class MemorySink implements Sink {
  readonly parts: Buffer[] = [];
  async append(b: Buffer) { this.parts.push(Buffer.from(b)); }
  async checkpoint() { return null; }
  async finish() { return this.buffer().length; }
  buffer() { return Buffer.concat(this.parts); }
}

export class MemorySource implements Source {
  constructor(private readonly buf: Buffer) {}
  async size() { return this.buf.length; }
  async read(offset: number, length: number) { return this.buf.subarray(offset, offset + length); }
}
