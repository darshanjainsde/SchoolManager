/**
 * THE SMALL SUBSET OF FORMATTING A SCHOOL CAN TYPE.
 *
 * A custom page needed bold, a link inside a sentence, and lists — the three
 * things missing from `whitespace-pre-line` that make a page unreadable
 * without them. The obvious answers are both wrong:
 *
 *  - A rich-text editor storing HTML gives us a sanitising problem forever,
 *    and one escaped `<script>` away from a school's site being the thing
 *    that ships it.
 *  - A toolbar storing styled spans needs a contenteditable editor, which is
 *    a month of work and a decade of browser bugs.
 *
 * So the storage does not change at all: a paragraph is still a plain string,
 * and these marks are parsed on the way OUT, into React elements. Nothing in
 * the database is ever interpreted as markup, the editor stays a textarea,
 * and the whole thing is a pure function with tests.
 *
 *   **bold**        *italic*        [the office](/contact)
 *   - a bullet      1. a number
 *
 * Deliberately NOT supported: headings (that is the Heading block), images
 * (the Image block), tables (the Table block), raw HTML (never). A school
 * reaching for those has a block for them, which keeps the page inside the
 * school's own design.
 */

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  /** Already checked against `safeHref`; never a `javascript:` URL. */
  href?: string;
}

export type RichLine =
  | { kind: 'p'; spans: Span[] }
  | { kind: 'ul'; items: Span[][] }
  | { kind: 'ol'; items: Span[][] };

/** A link a school may type. Everything else becomes plain text. */
function safeLink(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith('/') || h.startsWith('#')) return h;
  return /^(https?:|mailto:|tel:)/i.test(h) ? h : null;
}

/**
 * Inline marks, innermost-last: bold before italic so `**a**` is not read as
 * an italic `*` wrapping `a*`. Unmatched markers stay as literal characters —
 * a school writing "5 * 3" gets "5 * 3".
 */
export function parseInline(raw: string): Span[] {
  const out: Span[] = [];
  // One pass, one regex: a link, then bold, then italic. Order matters.
  const re = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string, extra?: Omit<Span, 'text'>) => {
    if (!text) return;
    out.push(extra ? { text, ...extra } : { text });
  };
  while ((m = re.exec(raw)) !== null) {
    push(raw.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = safeLink(m[2]);
      // A refused link keeps its words — losing the sentence would be worse
      // than losing the link.
      push(m[1], href ? { href } : undefined);
    } else if (m[3] !== undefined) {
      push(m[3], { bold: true });
    } else if (m[4] !== undefined) {
      push(m[4], { italic: true });
    }
    last = m.index + m[0].length;
  }
  push(raw.slice(last));
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Lines → paragraphs and lists. Consecutive bullets are one list; a blank
 * line ends a paragraph, as everybody already expects from typing.
 */
export function parseRichText(raw: string): RichLine[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const out: RichLine[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    // Single newlines inside a paragraph are kept, as they were before this
    // existed — a school typing an address over three lines still gets three.
    out.push({ kind: 'p', spans: parseInline(para.join('\n')) });
    para = [];
  };

  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (bullet || number) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      const item = parseInline((bullet ?? number)![1]);
      const tail = out[out.length - 1];
      if (tail && tail.kind === kind) tail.items.push(item);
      else out.push(kind === 'ul' ? { kind: 'ul', items: [item] } : { kind: 'ol', items: [item] });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return out;
}

/** True when the text uses any of the marks — the editor's hint shows only when it is not already obvious. */
export function hasMarks(raw: string): boolean {
  return /\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)|^\s*(?:[-*]|\d+[.)])\s+/m.test(raw);
}
