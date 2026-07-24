import { z } from 'zod';
import type { BlogBlock } from './types';

/**
 * Client-side validation mirroring the API's DTO rules exactly (see
 * apps/api/src/modules/blog/internal/blog.dto.ts and
 * blog-sections.validator.ts) so the school console can reject obviously
 * invalid input before round-tripping to the server. The API remains the
 * source of truth — this is purely a UX nicety.
 */

export const SLUG_RE = /^[a-z0-9-]{3,80}$/;
const MAX_BLOCKS = 40;

export function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return false;
}

/** Base post fields — title/description/slug/heroImageUrl/readMinutes. */
export const postFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Title must be 120 characters or fewer'),
  description: z.string().trim().min(1, 'Description is required').max(200, 'Description must be 200 characters or fewer'),
  slug: z
    .string()
    .regex(SLUG_RE, 'Slug must be lowercase letters, numbers and hyphens, 3-80 characters long'),
  heroImageUrl: z
    .string()
    .refine((v) => v === '' || isValidImageUrl(v), 'Must be an https:// URL, or a path starting with a single "/"')
    .optional(),
  readMinutes: z.number().int().min(1, 'At least 1 minute').max(60, 'At most 60 minutes'),
});

export type PostFieldsInput = z.input<typeof postFieldsSchema>;

/** Returns a flat list of human-readable error messages, empty when valid. */
export function validatePostFields(input: PostFieldsInput): string[] {
  const result = postFieldsSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => i.message);
}

/**
 * Structural + semantic validation for the block array — a direct port of
 * the API's `blogSectionsError` so authors see the exact same constraints
 * (quiz 2-4 options, correct index in range, etc.) before saving.
 */
export function validateSections(sections: BlogBlock[]): string | null {
  if (sections.length === 0) return 'Add at least one block';
  if (sections.length > MAX_BLOCKS) return `A post can have at most ${MAX_BLOCKS} blocks`;
  for (let i = 0; i < sections.length; i++) {
    const err = blockError(sections[i]);
    if (err) return `Block ${i + 1} (${sections[i].t}): ${err}`;
  }
  return null;
}

function blockError(block: BlogBlock): string | null {
  switch (block.t) {
    case 'h':
    case 'p':
      if (!block.text || !block.text.trim()) return 'text is required';
      return null;

    case 'ul':
      if (!block.items || block.items.filter((i) => i.trim()).length === 0) {
        return 'add at least one item';
      }
      return null;

    case 'img':
      if (!block.url) return 'image URL is required';
      if (!isValidImageUrl(block.url)) return 'URL must be https:// or a path starting with a single "/"';
      if (!block.alt || !block.alt.trim()) return 'alt text is required';
      return null;

    case 'stats':
      if (!block.items || block.items.length === 0) return 'add at least one stat';
      for (const it of block.items) {
        if (!it.value.trim() || !it.label.trim()) return 'each stat needs a value and label';
      }
      return null;

    case 'ranking':
      if (!block.items || block.items.length === 0) return 'add at least one row';
      for (const it of block.items) {
        if (!it.label.trim() || !it.value.trim()) return 'each row needs a label and value';
        if (typeof it.pct !== 'number' || it.pct < 0 || it.pct > 100) return 'percent must be between 0 and 100';
      }
      return null;

    case 'quiz': {
      if (!block.q || !block.q.trim()) return 'question is required';
      if (!block.options || block.options.length < 2 || block.options.length > 4) {
        return 'quiz needs between 2 and 4 options';
      }
      if (block.options.some((o) => !o.trim())) return 'options cannot be empty';
      if (
        typeof block.correct !== 'number' ||
        !Number.isInteger(block.correct) ||
        block.correct < 0 ||
        block.correct >= block.options.length
      ) {
        return 'mark one option as the correct answer';
      }
      if (!block.why || !block.why.trim()) return 'explanation ("why") is required';
      return null;
    }

    default:
      return 'unknown block type';
  }
}
