import { holidayTypeLabel, humanize, leaveTypeLabel, sportsGroupLabel, sportsGroupLine } from '../labels';

/** Codes on screen were the re-audit's "SICK", "jun Boys" and "FESTIVAL" (2026-10-08). */
describe('labels', () => {
  it('leave types read as words, unknown ones too', () => {
    expect(leaveTypeLabel('SICK')).toBe('Sick leave');
    expect(leaveTypeLabel('CASUAL')).toBe('Casual leave');
    expect(leaveTypeLabel('COMP_OFF')).toBe('Comp off leave');
  });
  it('holiday types and any code become sentence case', () => {
    expect(holidayTypeLabel('FESTIVAL')).toBe('Festival');
    expect(humanize('PARENT_TEACHER')).toBe('Parent teacher');
    expect(humanize('')).toBe('');
  });
  it('record-book groups use the school bands first, then the standard ones', () => {
    expect(sportsGroupLabel('jun')).toBe('Junior');
    expect(sportsGroupLabel('sub')).toBe('Sub-junior');
    expect(sportsGroupLabel('u14')).toBe('Under 14');
    expect(sportsGroupLabel('jun', [{ id: 'jun', label: 'Middle school' }])).toBe('Middle school');
    expect(sportsGroupLabel('open_age')).toBe('Open age');
    expect(sportsGroupLine('sen', 'Girls')).toBe('Senior girls');
  });
});
