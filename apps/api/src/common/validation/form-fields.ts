import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import { toE164 } from '../otp/phone-identity';

/**
 * A BLANK FORM FIELD MEANS "NOT GIVEN".
 *
 * `@IsOptional()` skips only null and undefined. An empty string still runs
 * every other validator, so a form that sends '' for an untouched dropdown or
 * date (which it does on purpose: '' is how an edit clears a column) was
 * refused with "designation must be one of…", "dob must be a valid ISO 8601
 * date string" — twelve of them on the Add teacher form, which an office read
 * as twelve required fields (2026-10-07).
 *
 * Put this BEFORE `@IsOptional()` on any optional field a form posts. A blank
 * or whitespace-only string becomes null: the optional check then skips it,
 * and Prisma writes null, which is what "clear this" always meant.
 */
export function BlankAsNull(): PropertyDecorator {
  return Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value));
}

/** Trim and lower-case an email so "Asha@School.in " and "asha@school.in" are one person. */
export function NormaliseEmail(): PropertyDecorator {
  return Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
}

/**
 * A number that resolves to a reachable mobile — the same rule every phone on
 * the platform goes through (`toE164`): 10 digits starting 6–9, with or
 * without +91, spaces, dashes or a trunk zero.
 */
export function IsMobile(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isMobile',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && toE164(value) !== null,
        defaultMessage: () => 'Enter a 10-digit mobile number.',
      },
    },
    options,
  );
}
