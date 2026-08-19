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

/** Mirror of the web's sanitizeSectionCss — strips everything that could
 *  reach outside a stylesheet: markup, imports, external fetches, legacy
 *  script vectors. */
export function sanitizeCustomCss(css: string): string {
  return css
    .slice(0, CUSTOM_CSS_MAX)
    .replace(/</g, ' ')
    .replace(/@import[^;{]*(;|$)/gi, '')
    .replace(/@charset[^;]*;/gi, '')
    .replace(/expression\s*\(/gi, 'no-expression(')
    .replace(/javascript\s*:/gi, 'blocked:')
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
 * and a filtered inline style. No scripts, no frames, no event handlers, no
 * form elements — anything needing behaviour belongs in a sandboxed embed,
 * not here.
 */
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
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'http', 'data'] },
    // Inline styles pass through sanitize-html's parser, which drops
    // url(javascript:) and friends; expression() died with IE.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  });
}
