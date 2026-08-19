import sanitizeHtml from 'sanitize-html';

/**
 * Write-side defence for the custom-code escape hatch. The renderer scopes and
 * re-sanitizes on read (apps/web site-variants.ts) — neither side trusts the
 * stored value alone. This file is deliberately dependency-light and pure so
 * it can be unit-tested without Nest.
 *
 * Kept in the API rather than shared from the web package: the dependency
 * boundary runs the other way, and a duplicated 30-line sanitizer that each
 * side tests is safer than a widened import path.
 */

export const CUSTOM_CSS_MAX = 20_000;
export const CUSTOM_HTML_MAX = 20_000;

/**
 * Decode CSS escapes and drop comments BEFORE any keyword match.
 *
 * The browser reads `@\69mport` as `@import` and `u\72l(` as `url(`, and it
 * treats `/*...*\/` as whitespace — so a sanitizer that regexes the literal
 * words is matching a surface the browser never sees. Normalizing to the form
 * the browser will actually parse is what makes the strips below sound.
 */
function normalizeCssForScan(css: string): string {
  // Strip comments first (they cannot split a token, but they can pad a
  // keyword scan and they have no place in a one-section override).
  let out = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ');
  // Decode CSS escapes: \<1-6 hex><optional ws> → char; \<other> → that char.
  out = out.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])/g, (_m, hex, ch) => {
    if (hex) {
      const code = parseInt(hex, 16);
      // Drop NUL and out-of-range code points rather than emit a replacement
      // char that could recombine into something.
      if (code === 0 || code > 0x10ffff) return '';
      return String.fromCodePoint(code);
    }
    return ch;
  });
  return out;
}

/** Mirror of the web's sanitizeSectionCss — strips everything that could
 *  reach outside a stylesheet: markup, imports, external fetches, legacy
 *  script vectors. Escapes/comments are normalized away first so the keyword
 *  strips actually see what the browser will. */
export function sanitizeCustomCss(css: string): string {
  return normalizeCssForScan(css.slice(0, CUSTOM_CSS_MAX))
    .replace(/</g, ' ')
    // @import in BOTH forms: url(...) and the bare-string form.
    .replace(/@import[^;{]*(;|$)/gi, '')
    .replace(/@charset[^;]*;/gi, '')
    .replace(/expression\s*\(/gi, 'no-expression(')
    .replace(/javascript\s*:/gi, 'blocked:')
    // -moz-binding could load remote XBL on very old Firefox.
    .replace(/-moz-binding\s*:/gi, 'blocked:')
    // Any url() whose target is not a data: URI is neutralized — tracking
    // pixels and attribute-selector exfiltration are not what an override is
    // for; inline data: gradients/SVG stay.
    .replace(/url\(\s*(['"]?)(?!\s*data:)/gi, 'url($1about:invalid#');
}

/** Every stored per-section override sanitized; unknown keys dropped. */
const CSS_SECTION_KEYS = ['hero', 'stats', 'about', 'courses', 'admissions', 'gallery', 'staff', 'footer', 'page'];
export function sanitizeCustomCssMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of CSS_SECTION_KEYS) {
    const css = (raw as Record<string, unknown>)[key];
    if (typeof css === 'string' && css.trim()) out[key] = sanitizeCustomCss(css);
  }
  return out;
}

/**
 * The HTML block: allow-listed structural + text tags, styleable via class
 * and a TIGHTLY-filtered inline style. No scripts, no frames, no event
 * handlers, no form elements — anything needing behaviour belongs in a
 * sandboxed embed, not here.
 *
 * `style` is not free-form: a bare `style` attribute with no `allowedStyles`
 * is fully UNFILTERED — it would pass `background:url(https://tracker)` and,
 * worse, `position:fixed;inset:0;z-index:9999` (a full-page clickjacking
 * overlay) straight to every visitor. So the allow-list below is a curated
 * set of layout/type properties, each guarded by a value regex that forbids
 * parentheses entirely — which rules out url(), expression() and calc() in
 * one stroke — and `position` is deliberately absent so no override can pin
 * itself over the real page.
 */
const SAFE_STYLE_VALUE = [/^[^;{}()<>@]*$/];
const ALLOWED_STYLE_PROPS = [
  'color', 'background-color', 'text-align', 'text-decoration', 'text-transform',
  'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'letter-spacing',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'border-color', 'border-width', 'border-style',
  'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height',
  'display', 'gap', 'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content',
  'grid-template-columns', 'opacity', 'box-shadow', 'aspect-ratio', 'object-fit', 'overflow',
];

export function sanitizeHtmlBlock(html: string): string {
  return sanitizeHtml(html.slice(0, CUSTOM_HTML_MAX), {
    allowedTags: [
      'div', 'section', 'span', 'p', 'a', 'b', 'strong', 'i', 'em', 'u', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      '*': ['class', 'style'],
      a: ['href', 'target', 'rel', 'class', 'style'],
      img: ['src', 'alt', 'width', 'height', 'loading', 'class', 'style'],
    },
    allowedStyles: {
      '*': Object.fromEntries(ALLOWED_STYLE_PROPS.map((p) => [p, SAFE_STYLE_VALUE])),
    },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'http', 'data'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  });
}
