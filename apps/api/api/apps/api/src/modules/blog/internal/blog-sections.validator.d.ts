import { ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import type { BlogBlock } from '@skoolos/db';
/**
 * Allow-list scheme check for user-supplied image URLs (hero images, `img`
 * blocks). Only https:// (http:// for local dev) or a same-origin relative
 * path starting with a single `/` are accepted — this rejects `javascript:`,
 * `data:`, and every other scheme, and also rejects protocol-relative
 * `//host` URLs (which start with `/` but escape the origin).
 */
export declare function isValidImageUrl(url: string): boolean;
/**
 * Structural validation for `BlogPost.sections` (BlogBlock[] stored as Json).
 * Discriminates on `t` and validates each block's shape per the Block Schema
 * in the blog platform plan — including quiz's 2-4 options / correct index
 * invariant. Returns a human-readable error string, or `null` when valid.
 */
export declare function blogSectionsError(sections: unknown): string | null;
export declare class BlogSectionsConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean;
    defaultMessage(args: ValidationArguments): string;
}
/** Validates DTO-level image URL fields (e.g. `heroImageUrl`) against the same allow-list as `img` blocks. */
export declare class ImageUrlConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean;
    defaultMessage(): string;
}
export type { BlogBlock };
//# sourceMappingURL=blog-sections.validator.d.ts.map