import { AGE_GROUPS, DEFAULT_BANDS, type Band } from '@skoolos/types';

/**
 * WORDS FOR CODES. The API speaks in codes (SICK, FESTIVAL, jun); a person
 * reads words. The re-audit of 2026-10-08 found the codes on screen as-is:
 * "SICK · 28 Oct" on the leave desk, "jun Boys" / "sen Girls" in the record
 * book, "FESTIVAL" on holidays. Every code that reaches a screen goes through
 * here; an unknown one still reads as a word, never as SHOUTING_SNAKE_CASE.
 */

/** "PARENT_TEACHER" → "Parent teacher". */
export function humanize(code: string): string {
  const s = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : code;
}

const LEAVE: Record<string, string> = {
  SICK: 'Sick leave',
  CASUAL: 'Casual leave',
  EARNED: 'Earned leave',
  UNPAID: 'Unpaid leave',
  MATERNITY: 'Maternity leave',
  PATERNITY: 'Paternity leave',
  OTHER: 'Other leave',
};

/** SICK → "Sick leave". */
export function leaveTypeLabel(type: string): string {
  return LEAVE[type] ?? `${humanize(type)} leave`;
}

/** FESTIVAL → "Festival". */
export function holidayTypeLabel(type: string): string {
  return humanize(type);
}

/**
 * A record-book group key → its name: the school's own band label when the
 * school renamed or added bands, else the standard bands and age groups
 * ("jun" → "Junior", "u14" → "Under 14").
 */
export function sportsGroupLabel(key: string, bands?: readonly Pick<Band, 'id' | 'label'>[] | null): string {
  return (
    bands?.find((b) => b.id === key)?.label ??
    DEFAULT_BANDS.find((b) => b.id === key)?.label ??
    AGE_GROUPS.find((g) => g.id === key)?.label ??
    humanize(key)
  );
}

/** "jun" + "Boys" → "Junior boys". */
export function sportsGroupLine(key: string, category: string, bands?: readonly Pick<Band, 'id' | 'label'>[] | null): string {
  return `${sportsGroupLabel(key, bands)} ${category.toLowerCase()}`;
}
