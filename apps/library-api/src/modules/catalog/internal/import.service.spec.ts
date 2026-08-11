import { ImportService, MAX_IMPORT_ROWS, mapImportRow } from './import.service';

describe('mapImportRow', () => {
  it('maps a fully-populated row', () => {
    const result = mapImportRow(
      {
        isbn: '9780140328721',
        title: 'Fantastic Mr Fox',
        subtitle: 'A Fable',
        author: 'Dahl, Roald',
        publisher: 'Puffin',
        publishedyear: '1988',
        edition: '2nd',
        language: 'en',
        callnumber: 'F DAH',
        category: 'Fiction',
      },
      1,
    );

    expect(result).toEqual({
      data: {
        isbn13: '9780140328721',
        isbn10: undefined,
        title: 'Fantastic Mr Fox',
        subtitle: 'A Fable',
        author: 'Dahl, Roald',
        publisher: 'Puffin',
        publishedYear: 1988,
        edition: '2nd',
        language: 'en',
        callNumber: 'F DAH',
        category: 'Fiction',
      },
    });
  });

  it('accepts a 10-digit isbn (with a trailing check-digit X) into isbn10, not isbn13', () => {
    const result = mapImportRow({ isbn: '014032872X', title: 'T' }, 2);
    expect(result).toEqual({ data: expect.objectContaining({ isbn13: undefined, isbn10: '014032872X' }) });
  });

  it('strips hyphens and whitespace from the isbn before validating', () => {
    const result = mapImportRow({ isbn: '978-0-14-032872-1', title: 'T' }, 1);
    expect(result).toEqual({ data: expect.objectContaining({ isbn13: '9780140328721' }) });
  });

  it('errors with row + field when isbn is missing, without touching other fields', () => {
    expect(mapImportRow({ title: 'No ISBN' }, 7)).toEqual({
      error: { row: 7, field: 'isbn', message: 'isbn is required' },
    });
  });

  it('errors with row + field when isbn is the wrong length', () => {
    expect(mapImportRow({ isbn: '123', title: 'Bad ISBN' }, 3)).toEqual({
      error: { row: 3, field: 'isbn', message: 'isbn must be 10 or 13 characters' },
    });
  });

  it('errors with row + field when title is missing', () => {
    expect(mapImportRow({ isbn: '9780140328721' }, 4)).toEqual({
      error: { row: 4, field: 'title', message: 'title is required' },
    });
  });

  it('errors with row + field when publishedYear is not a valid integer', () => {
    expect(mapImportRow({ isbn: '9780140328721', title: 'T', publishedyear: 'not-a-year' }, 5)).toEqual({
      error: { row: 5, field: 'publishedYear', message: 'publishedYear must be an integer between 0 and 3000' },
    });
  });

  it('errors with row + field when publishedYear is out of range', () => {
    expect(mapImportRow({ isbn: '9780140328721', title: 'T', publishedyear: '4000' }, 6)).toEqual({
      error: { row: 6, field: 'publishedYear', message: 'publishedYear must be an integer between 0 and 3000' },
    });
  });

  it('leaves optional fields undefined rather than empty strings when the CSV cell is blank', () => {
    const result = mapImportRow({ isbn: '9780140328721', title: 'T', subtitle: '' }, 1);
    expect(result).toEqual({ data: expect.objectContaining({ subtitle: undefined }) });
  });
});

describe('ImportService.importTitles — row cap', () => {
  // orgId is deliberately NOT a UUID here, so that if the cap check is ever
  // wrong, the test finds out from the cap check itself rather than from
  // however `withOrg`/Postgres happens to react — `withOrg` synchronously
  // rejects a non-UUID orgId (see `packages/library-db/src/index.ts`)
  // before it ever opens a connection, so both assertions below are
  // provably about `importTitles`'s own cap check, not a side effect of
  // whatever database happens to be reachable from this test run.
  const NOT_A_UUID = 'not-a-real-org-id';

  it('rejects a request over MAX_IMPORT_ROWS with a 413 naming the limit, before touching the database', async () => {
    const service = new ImportService();
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ isbn: '9780140328721', title: 'T' }));

    await expect(service.importTitles(NOT_A_UUID, tooMany)).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining(String(MAX_IMPORT_ROWS)),
    });
  });

  it('does not reject on the cap check for a file of exactly MAX_IMPORT_ROWS', async () => {
    const service = new ImportService();
    const exactly = Array.from({ length: MAX_IMPORT_ROWS }, () => ({ isbn: '9780140328721', title: 'T' }));

    // Falls through the (now-passed) cap check into withOrg, which rejects
    // for the deterministic "not a UUID" reason instead — proving the cap
    // check was not what rejected this call.
    await expect(service.importTitles(NOT_A_UUID, exactly)).rejects.toThrow('withOrg: orgId must be a UUID');
  });
});
