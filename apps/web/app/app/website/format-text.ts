/**
 * What the formatting toolbar does to a plain string. Pure, so it is tested
 * without a DOM: given the text and the selection, return the new text and
 * where the selection should land.
 *
 * Every output is in the grammar components/public/page-text.ts parses —
 * `**bold**`, `*italic*`, `- ` and `1. ` line prefixes — and each action
 * toggles, so pressing a button twice gets back what was there.
 */
export type FormatAction = 'bold' | 'italic' | 'bullets' | 'numbers';

export interface FormatResult {
  value: string;
  start: number;
  end: number;
}

const BULLET = /^(\s*)[-*]\s+/;
const NUMBER = /^(\s*)\d+[.)]\s+/;

function wrap(value: string, start: number, end: number, mark: string): FormatResult {
  const sel = value.slice(start, end);
  const n = mark.length;
  // Selected text already carries the marks → take them off.
  if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(n, sel.length - n);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  // The marks sit just outside the selection → take them off.
  if (value.slice(start - n, start) === mark && value.slice(end, end + n) === mark) {
    return {
      value: value.slice(0, start - n) + sel + value.slice(end + n),
      start: start - n,
      end: end - n,
    };
  }
  // Nothing selected → a pair with the caret between, ready to type into.
  if (start === end) {
    return { value: value.slice(0, start) + mark + mark + value.slice(end), start: start + n, end: start + n };
  }
  // The marks must hug the words: `** word **` is not bold in the parser, so
  // leading/trailing spaces in the selection stay outside the marks.
  const lead = sel.length - sel.trimStart().length;
  const trail = sel.length - sel.trimEnd().length;
  const core = sel.trim();
  const wrapped = sel.slice(0, lead) + mark + core + mark + sel.slice(sel.length - trail);
  return {
    value: value.slice(0, start) + wrapped + value.slice(end),
    start: start + lead + n,
    end: start + lead + n + core.length,
  };
}

function prefixLines(value: string, start: number, end: number, kind: 'bullets' | 'numbers'): FormatResult {
  // Widen the selection to whole lines.
  const from = value.lastIndexOf('\n', start - 1) + 1;
  // A selection ending just after a newline does not include the next line.
  const stop = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', stop);
  const to = nl === -1 ? value.length : nl;

  const lines = value.slice(from, to).split('\n');
  const mine = kind === 'bullets' ? BULLET : NUMBER;
  const filled = lines.filter((l) => l.trim() !== '');
  const allMine = filled.length > 0 && filled.every((l) => mine.test(l));

  let k = 0;
  const next = lines.map((l) => {
    // Strip whichever list prefix the line has, so bullets ↔ numbers switches.
    const bare = l.replace(BULLET, '$1').replace(NUMBER, '$1');
    if (allMine) return bare;
    // A blank line between items is left blank: it is what separates two
    // lists, and prefixing it would give an empty bullet.
    if (l.trim() === '' && lines.length > 1) return l;
    k += 1;
    return kind === 'bullets' ? `- ${bare}` : `${k}. ${bare}`;
  });

  const block = next.join('\n');
  const out = value.slice(0, from) + block + value.slice(to);
  // On a single empty line, park the caret after the new prefix.
  if (lines.length === 1 && lines[0].trim() === '') {
    return { value: out, start: from + block.length, end: from + block.length };
  }
  return { value: out, start: from, end: from + block.length };
}

export function applyFormat(value: string, start: number, end: number, action: FormatAction): FormatResult {
  const a = Math.max(0, Math.min(start, end, value.length));
  const b = Math.max(0, Math.min(Math.max(start, end), value.length));
  if (action === 'bold') return wrap(value, a, b, '**');
  if (action === 'italic') return wrap(value, a, b, '*');
  return prefixLines(value, a, b, action);
}
