import { csvField } from './owner-overview.service';

describe('csvField', () => {
  it('passes plain values through', () => {
    expect(csvField('Sunita Rao')).toBe('Sunita Rao');
  });
  it('quotes commas', () => {
    expect(csvField('St. Mary\'s, Pune')).toBe('"St. Mary\'s, Pune"');
  });
  it('escapes embedded quotes', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });
  it('quotes newlines', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
  it('renders null/undefined as empty', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});
