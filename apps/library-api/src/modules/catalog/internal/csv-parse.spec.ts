import { parseCsv, parseCsvRecords } from './csv-parse';

describe('parseCsv', () => {
  it('splits a simple comma-separated file into rows of cells', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a comma inside a quoted field as literal text, not a delimiter', () => {
    expect(parseCsv('title,author\n"Lord, The Rings",Tolkien')).toEqual([
      ['title', 'author'],
      ['Lord, The Rings', 'Tolkien'],
    ]);
  });

  it('keeps an embedded newline inside a quoted field as literal text, not a row break', () => {
    expect(parseCsv('title\n"Line one\nLine two"')).toEqual([['title'], ['Line one\nLine two']]);
  });

  it('unescapes a doubled quote ("") inside a quoted field to one literal quote', () => {
    expect(parseCsv('title\n"She said ""hi"""')).toEqual([['title'], ['She said "hi"']]);
  });

  it('handles CRLF line endings the same as LF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops a trailing blank line rather than emitting a phantom empty row', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseCsvRecords', () => {
  it('maps each data row to an object keyed by normalized header cells', () => {
    const { header, records } = parseCsvRecords('ISBN, Title ,Published Year\n9780140328721,Fantastic Mr Fox,1988');
    expect(header).toEqual(['isbn', 'title', 'publishedyear']);
    expect(records).toEqual([{ isbn: '9780140328721', title: 'Fantastic Mr Fox', publishedyear: '1988' }]);
  });

  it('trims cell whitespace', () => {
    const { records } = parseCsvRecords('title\n  Padded Title  ');
    expect(records[0].title).toBe('Padded Title');
  });

  it('fills a missing trailing cell as an empty string rather than leaving the key unset', () => {
    const { records } = parseCsvRecords('isbn,title\n9780140328721');
    expect(records[0]).toEqual({ isbn: '9780140328721', title: '' });
  });

  it('returns no header and no records for empty input', () => {
    expect(parseCsvRecords('')).toEqual({ header: [], records: [] });
  });
});
