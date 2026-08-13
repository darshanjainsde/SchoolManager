import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrefixTsQuery, tokenize, SearchService } from './search.service';
import type { LibraryTx } from '@library/db';

describe('tokenize', () => {
  it('extracts plain words', () => {
    expect(tokenize('lord of the rings')).toEqual(['lord', 'of', 'the', 'rings']);
  });

  it('strips tsquery operator characters instead of preserving them as tokens', () => {
    // The entire safety argument for building to_tsquery input by hand rests
    // on this: none of &, |, !, (, ), :, ' can survive tokenization to reach
    // the built query string.
    expect(tokenize("foo & bar' | (baz) ! qux:*")).toEqual(['foo', 'bar', 'baz', 'qux']);
  });

  it('returns an empty array for input with no word characters at all', () => {
    expect(tokenize('!!! --- ???')).toEqual([]);
  });

  it('extracts unicode letters, not just ASCII', () => {
    expect(tokenize('Café Müller')).toEqual(['Café', 'Müller']);
  });
});

describe('buildPrefixTsQuery', () => {
  it('joins tokens with & and marks only the last one as a prefix match', () => {
    expect(buildPrefixTsQuery(['lord', 'ring'])).toBe('lord & ring:*');
  });

  it('marks the single token as a prefix match when there is only one', () => {
    expect(buildPrefixTsQuery(['tolkien'])).toBe('tolkien:*');
  });

  it('returns an empty string for no tokens', () => {
    expect(buildPrefixTsQuery([])).toBe('');
  });
});

describe('SearchService.searchTitles — parameterization', () => {
  /**
   * Verifies the safety property Trap 15 exists to catch: whatever the
   * caller types, the built tsquery text and the ILIKE pattern are always
   * passed to Postgres as bound parameters of the tagged-template raw
   * query, never spliced into the SQL string itself. `tx.$queryRaw` is
   * mocked here to capture exactly what Prisma would send — the SQL
   * "strings" array (the literal, attacker-uncontrollable template
   * fragments) and the interpolated "values" array (where user input must
   * land) — the live e2e suite (catalog-search.e2e.spec.ts) is what proves
   * the query is actually correct against real Postgres; this test only
   * proves the shape is a parameterized query, not string concatenation.
   */
  function captureQueryRaw() {
    const calls: { strings: readonly string[]; values: unknown[] }[] = [];
    const tx = {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ strings: [...strings], values });
        return Promise.resolve([]);
      },
    } as unknown as LibraryTx;
    return { tx, calls };
  }

  it('never splices a malicious query string into the SQL text', async () => {
    const { tx, calls } = captureQueryRaw();
    const service = new SearchService();
    const orgId = '11111111-1111-4111-8111-111111111111';
    const malicious = "'; DROP TABLE \"Title\"; --";

    await service.searchTitles(tx, orgId, malicious, 'LIBRARIAN', 10);

    expect(calls).toHaveLength(1);
    const { strings, values } = calls[0];
    // The malicious text must appear only among the bound values, never as
    // a substring of any literal SQL fragment.
    for (const fragment of strings) {
      expect(fragment).not.toContain('DROP TABLE');
    }
    const serializedValues = JSON.stringify(values);
    expect(serializedValues).toContain('DROP TABLE'); // tokenized fragments do land in the ILIKE pattern value
  });

  it('falls back to the no-token branch (single query, org-filtered, no to_tsquery call) when nothing tokenizes', async () => {
    const { tx, calls } = captureQueryRaw();
    const service = new SearchService();
    const orgId = '11111111-1111-4111-8111-111111111111';

    await service.searchTitles(tx, orgId, '!!!', 'LIBRARIAN', 10);

    expect(calls).toHaveLength(1);
    expect(calls[0].strings.join('')).not.toContain('to_tsquery');
    expect(calls[0].values).toContain(orgId);
  });

  it('clamps limit into [1, 100] rather than passing an out-of-range value straight to SQL', async () => {
    const { tx, calls } = captureQueryRaw();
    const service = new SearchService();
    const orgId = '11111111-1111-4111-8111-111111111111';

    await service.searchTitles(tx, orgId, 'lord', 'LIBRARIAN', 10_000);
    expect(calls[0].values).toContain(100);

    await service.searchTitles(tx, orgId, 'lord', 'LIBRARIAN', -5);
    expect(calls[1].values).toContain(1);
  });
});

describe('SearchService.searchTitles — replacement price is staff-only', () => {
  /**
   * Both branches of `searchTitles` (the tokenized search and the empty-query
   * listing) are exercised, because they are two separate raw queries and a
   * strip applied to only one of them is exactly the kind of half-fix that
   * looks green.
   */
  function serviceReturning(rows: unknown[]) {
    const tx = { $queryRaw: () => Promise.resolve(rows) } as unknown as LibraryTx;
    return { tx, service: new SearchService() };
  }

  const ORG = '11111111-1111-4111-8111-111111111111';
  const ROW = { id: 'a', title: 'The Hungry Tide', replacementPrice: 399 };

  it.each(['', 'hungry'])(
    'omits the price for a MEMBER (query: "%s")',
    async (query) => {
      const { tx, service } = serviceReturning([ROW]);
      const [hit] = await service.searchTitles(tx, ORG, query, 'MEMBER');
      expect('replacementPrice' in hit).toBe(false);
      // The rest of the hit must survive — this is a redaction, not a filter.
      expect(hit).toMatchObject({ id: 'a', title: 'The Hungry Tide' });
    },
  );

  it.each(['', 'hungry'])(
    'keeps the price for a LIBRARIAN (query: "%s")',
    async (query) => {
      const { tx, service } = serviceReturning([ROW]);
      const [hit] = await service.searchTitles(tx, ORG, query, 'LIBRARIAN');
      expect(hit).toHaveProperty('replacementPrice', 399);
    },
  );

  it('selects the column on both branches, so the strip is what protects it', () => {
    // If a future edit dropped "replacementPrice" from the SELECT lists, the
    // MEMBER tests above would still pass — vacuously — while a LIBRARIAN
    // silently lost the field.
    //
    // Counted inside the SQL template literals only, not across the whole file:
    // a plain file-wide match is satisfied by any two mentions, so an edit that
    // removed the column from the SQL while adding a sentence about it to the
    // JSDoc above would stay green. The e2e's `priceOn(asLibrarian) === '399'`
    // is the real, behavioural guard; this one exists to fail FAST and name the
    // cause, without a database.
    const source = readFileSync(join(__dirname, 'search.service.ts'), 'utf8');
    const sqlOnly = [...source.matchAll(/\$queryRaw<[^>]*>`([\s\S]*?)`/g)].map((m) => m[1]);
    expect(sqlOnly).toHaveLength(2); // the no-token listing and the tokenized search
    for (const sql of sqlOnly) {
      expect(sql).toMatch(/"replacementPrice"/);
    }
  });
});
