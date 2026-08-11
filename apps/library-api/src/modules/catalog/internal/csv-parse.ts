/**
 * Hand-rolled RFC 4180 CSV parser, kept dependency-free on purpose: the
 * import feature is the whole reason this task exists, and adding a new
 * runtime dependency for something this small is more surface area than the
 * "single focused task" scope this ships under can absorb. Handles the
 * three things a naive `split(',')` gets wrong — quoted fields containing
 * commas, quoted fields containing embedded newlines, and `""` as an
 * escaped literal quote inside a quoted field — because a real librarian's
 * export (titles/authors with commas in them) will hit all three.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Normalize line endings up front so the state machine below only has to
  // reason about '\n' as a row terminator, not '\r\n' vs '\n' vs a bare
  // '\r' (old Mac exports).
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];

    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  // Flush whatever the loop was building, unless the file ended cleanly on
  // a row terminator (in which case there is nothing left to flush) or the
  // file was empty to begin with.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Fully blank lines (a trailing newline at EOF, or a stray blank line a
  // spreadsheet export left in the middle) are noise, not data — drop rows
  // that are a single empty field.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Normalizes a header cell for matching: lowercase, strip everything but letters/digits. */
function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parses CSV text into header-mapped records. The first row is always
 * treated as the header. Extra columns the import doesn't recognise are
 * kept under their normalized name (harmless — `mapImportRow` below only
 * reads the keys it knows) rather than dropped, so an unrecognised header
 * shows up as a no-op instead of silently losing that column's data.
 */
export function parseCsvRecords(text: string): { header: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { header: [], records: [] };

  const [rawHeader, ...dataRows] = rows;
  const header = rawHeader.map(normalizeHeader);

  const records = dataRows.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      if (!key) return; // unnamed column — nothing to key it by
      record[key] = (cells[idx] ?? '').trim();
    });
    return record;
  });

  return { header, records };
}
