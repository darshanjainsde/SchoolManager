/**
 * Moved to common/dates/timetable-date.ts so the library wing can read the
 * IST day without importing the management barrel (which now imports the
 * library barrel for the year-end facade — a cycle otherwise). Re-exported
 * here so nothing inside management had to change.
 */
export * from '../../../common/dates/timetable-date';
