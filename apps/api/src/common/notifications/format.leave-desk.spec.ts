import { coverCancelledReason, formatNotification } from './format';

describe('push text for the leave desk notices', () => {
  it('a withdrawn leave names the teacher and, only when there were any, the covers released', () => {
    const p = { schoolName: 'Raffles', leaveId: 'l1', teacherName: 'Priya Nair', dates: 'Mon 13 Oct 2026' };
    expect(formatNotification({ kind: 'LEAVE_CANCELLED', payload: { ...p, releasedCovers: 2 } })).toEqual({ title: 'Leave withdrawn: Priya Nair', body: 'Mon 13 Oct 2026 · 2 covers released' });
    expect(formatNotification({ kind: 'LEAVE_CANCELLED', payload: { ...p, releasedCovers: 1 } }).body).toBe('Mon 13 Oct 2026 · 1 cover released');
    expect(formatNotification({ kind: 'LEAVE_CANCELLED', payload: { ...p, releasedCovers: 0 } }).body).toBe('Mon 13 Oct 2026');
  });

  it('a called-off cover says why, in words', () => {
    expect(formatNotification({ kind: 'COVER_CANCELLED', payload: { schoolName: 'R', substitutionId: 's1', when: 'Mon 13 Oct 2026, Period 3', className: '9-A', why: 'CHANGED' } }))
      .toEqual({ title: 'Cover called off: 9-A', body: 'Mon 13 Oct 2026, Period 3 — the office has changed the cover.' });
    expect(coverCancelledReason('LEAVE_CANCELLED')).toBe('the leave it was for was cancelled');
    expect(coverCancelledReason('TEACHER_ON_LEAVE')).toBe('you are on leave that day');
  });

  it('classes still uncovered: singular and plural, with the note when there is one', () => {
    const base = { schoolName: 'R', forDate: '2026-10-13', forWhen: 'tomorrow, Tue 13 Oct 2026' };
    expect(formatNotification({ kind: 'COVER_UNFILLED', payload: { ...base, gaps: 1, note: "Kavya Rao can't take 9-A." } }))
      .toEqual({ title: '1 period still needs cover', body: "tomorrow, Tue 13 Oct 2026 · Kavya Rao can't take 9-A. Open Leave → Coverage." });
    expect(formatNotification({ kind: 'COVER_UNFILLED', payload: { ...base, gaps: 3, note: null } }))
      .toEqual({ title: '3 periods still need cover', body: 'tomorrow, Tue 13 Oct 2026. Open Leave → Coverage.' });
  });
});
