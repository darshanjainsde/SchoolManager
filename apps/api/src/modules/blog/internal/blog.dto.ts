import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  Validate,
} from 'class-validator';
import type { BlogBlock } from '@skoolos/db';
import { BlogSectionsConstraint, ImageUrlConstraint } from './blog-sections.validator';

const SLUG_RE = /^[a-z0-9-]{3,80}$/;

export class CreatePostDto {
  @IsString() @Length(1, 120) title!: string;
  @IsString() @Length(1, 200) description!: string;
  @IsString() @Matches(SLUG_RE, { message: 'slug must match ^[a-z0-9-]{3,80}$' }) slug!: string;
  @IsOptional() @IsString() @Validate(ImageUrlConstraint) heroImageUrl?: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) readMinutes?: number;
  @IsArray() @Validate(BlogSectionsConstraint) sections!: BlogBlock[];
}

export class UpdatePostDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @Length(1, 200) description?: string;
  // Slug is editable pre-publish only; publish locks it (enforced in the service).
  @IsOptional() @IsString() @Matches(SLUG_RE, { message: 'slug must match ^[a-z0-9-]{3,80}$' }) slug?: string;
  @IsOptional() @IsString() @Validate(ImageUrlConstraint) heroImageUrl?: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) readMinutes?: number;
  @IsOptional() @IsArray() @Validate(BlogSectionsConstraint) sections?: BlogBlock[];
}

export class AddSelectionDto {
  @IsUUID() postId!: string;
}

export class PatchSelectionDto {
  @IsOptional() @IsBoolean() isHero?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class BlogSettingsDto {
  @IsOptional() @IsIn(['HERO_GRID', 'GRID', 'LIST']) blogLayout?: 'HERO_GRID' | 'GRID' | 'LIST';
  @IsOptional() @IsInt() @Min(1) @Max(2) blogHeroLimit?: number;
}

export class RejectPostDto {
  @IsString() @Length(1, 500) reason!: string;
}

// ── Response shapes (plain interfaces — mirrors public.dto.ts's PublicSiteData) ──

export interface BlogCard {
  slug: string;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  publishedAt: Date | null;
  authorName?: string | null;
}

export interface BlogAuthor {
  name: string;
  host: string;
}

export interface BlogPostFull extends BlogCard {
  sections: BlogBlock[];
  author: BlogAuthor | null;
}
