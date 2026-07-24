import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import type { BlogBlock } from '@skoolos/db';

const MAX_BLOCKS = 40;
const MAX_TEXT_LEN = 20_000;

/**
 * Allow-list scheme check for user-supplied image URLs (hero images, `img`
 * blocks). Only https:// (http:// for local dev) or a same-origin relative
 * path starting with a single `/` are accepted — this rejects `javascript:`,
 * `data:`, and every other scheme, and also rejects protocol-relative
 * `//host` URLs (which start with `/` but escape the origin).
 */
export function isValidImageUrl(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return false;
}

const IMAGE_URL_MESSAGE =
  '"url" must be an https:// (or http:// for local dev) URL or a path starting with a single "/"';

/**
 * Structural validation for `BlogPost.sections` (BlogBlock[] stored as Json).
 * Discriminates on `t` and validates each block's shape per the Block Schema
 * in the blog platform plan — including quiz's 2-4 options / correct index
 * invariant. Returns a human-readable error string, or `null` when valid.
 */
export function blogSectionsError(sections: unknown): string | null {
  if (!Array.isArray(sections)) return 'sections must be an array';
  if (sections.length === 0) return 'sections must not be empty';
  if (sections.length > MAX_BLOCKS) return `sections must have at most ${MAX_BLOCKS} blocks`;
  for (let i = 0; i < sections.length; i++) {
    const err = blockError(sections[i]);
    if (err) return `sections[${i}]: ${err}`;
  }
  return null;
}

function blockError(block: unknown): string | null {
  if (!block || typeof block !== 'object') return 'block must be an object';
  const b = block as Record<string, unknown>;
  switch (b.t) {
    case 'h':
    case 'p':
      if (typeof b.text !== 'string' || b.text.length === 0) return '"text" must be a non-empty string';
      if (b.text.length > MAX_TEXT_LEN) return `"text" must be at most ${MAX_TEXT_LEN} characters`;
      return null;

    case 'ul': {
      if (!Array.isArray(b.items) || b.items.length === 0) return '"items" must be a non-empty array of strings';
      for (const item of b.items) {
        if (typeof item !== 'string') return '"items" must be a non-empty array of strings';
        if (item.length > MAX_TEXT_LEN) return `each "items" entry must be at most ${MAX_TEXT_LEN} characters`;
      }
      return null;
    }

    case 'img':
      if (typeof b.url !== 'string' || !b.url) return '"url" is required';
      if (!isValidImageUrl(b.url)) return IMAGE_URL_MESSAGE;
      if (typeof b.alt !== 'string') return '"alt" is required';
      if (b.caption !== undefined && typeof b.caption !== 'string') return '"caption" must be a string';
      return null;

    case 'stats': {
      if (!Array.isArray(b.items) || b.items.length === 0) return '"items" must be a non-empty array';
      for (const it of b.items) {
        if (!it || typeof it !== 'object') return 'stats item must be an object';
        const s = it as Record<string, unknown>;
        if (typeof s.value !== 'string' || typeof s.label !== 'string') {
          return 'stats item requires string "value" and "label"';
        }
        if (s.tone !== undefined && s.tone !== 'good' && s.tone !== 'bad') {
          return 'stats item "tone" must be "good" or "bad"';
        }
      }
      return null;
    }

    case 'ranking': {
      if (!Array.isArray(b.items) || b.items.length === 0) return '"items" must be a non-empty array';
      for (const it of b.items) {
        if (!it || typeof it !== 'object') return 'ranking item must be an object';
        const r = it as Record<string, unknown>;
        if (typeof r.label !== 'string' || typeof r.value !== 'string' || typeof r.pct !== 'number') {
          return 'ranking item requires string "label"/"value" and numeric "pct"';
        }
      }
      if (b.source !== undefined && typeof b.source !== 'string') return '"source" must be a string';
      return null;
    }

    case 'quiz': {
      if (typeof b.q !== 'string' || !b.q) return '"q" is required';
      if (b.q.length > MAX_TEXT_LEN) return `"q" must be at most ${MAX_TEXT_LEN} characters`;
      if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 4) {
        return 'quiz "options" must have between 2 and 4 entries';
      }
      if (!b.options.every((o) => typeof o === 'string')) return 'quiz "options" must be strings';
      if (b.options.some((o: string) => o.length > MAX_TEXT_LEN)) {
        return `each "options" entry must be at most ${MAX_TEXT_LEN} characters`;
      }
      if (typeof b.correct !== 'number' || !Number.isInteger(b.correct) || b.correct < 0 || b.correct >= b.options.length) {
        return '"correct" must be a valid index into "options"';
      }
      if (typeof b.why !== 'string' || !b.why) return '"why" is required';
      if (b.why.length > MAX_TEXT_LEN) return `"why" must be at most ${MAX_TEXT_LEN} characters`;
      if (b.tag !== undefined && typeof b.tag !== 'string') return '"tag" must be a string';
      return null;
    }

    default:
      return `unknown block type "${String(b.t)}"`;
  }
}

@ValidatorConstraint({ name: 'blogSections', async: false })
export class BlogSectionsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return blogSectionsError(value) === null;
  }
  defaultMessage(args: ValidationArguments): string {
    return blogSectionsError(args.value) ?? 'sections is invalid';
  }
}

/** Validates DTO-level image URL fields (e.g. `heroImageUrl`) against the same allow-list as `img` blocks. */
@ValidatorConstraint({ name: 'imageUrl', async: false })
export class ImageUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidImageUrl(value);
  }
  defaultMessage(): string {
    return IMAGE_URL_MESSAGE;
  }
}

export type { BlogBlock };
