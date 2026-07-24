import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import type { BlogBlock } from '@skoolos/db';

const MAX_BLOCKS = 40;

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
      return typeof b.text === 'string' && b.text.length > 0
        ? null
        : '"text" must be a non-empty string';

    case 'ul':
      return Array.isArray(b.items) && b.items.length > 0 && b.items.every((i) => typeof i === 'string')
        ? null
        : '"items" must be a non-empty array of strings';

    case 'img':
      if (typeof b.url !== 'string' || !b.url) return '"url" is required';
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
      if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 4) {
        return 'quiz "options" must have between 2 and 4 entries';
      }
      if (!b.options.every((o) => typeof o === 'string')) return 'quiz "options" must be strings';
      if (typeof b.correct !== 'number' || !Number.isInteger(b.correct) || b.correct < 0 || b.correct >= b.options.length) {
        return '"correct" must be a valid index into "options"';
      }
      if (typeof b.why !== 'string' || !b.why) return '"why" is required';
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

export type { BlogBlock };
