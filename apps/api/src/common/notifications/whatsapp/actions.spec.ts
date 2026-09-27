import { ackPayload, coverPayload, leavePayload, parseAction } from './actions';

const S = 'app-secret';
const LEAVE = '11111111-1111-1111-1111-111111111111';
const SUB = '22222222-2222-2222-2222-222222222222';
const TEACHER = '33333333-3333-3333-3333-333333333333';

describe('signed button payloads', () => {
  it('round-trips every action', () => {
    expect(parseAction(leavePayload('approve', LEAVE, S), S)).toEqual({ kind: 'leave', decision: 'approve', leaveId: LEAVE });
    expect(parseAction(leavePayload('reject', LEAVE, S), S)).toEqual({ kind: 'leave', decision: 'reject', leaveId: LEAVE });
    expect(parseAction(coverPayload(SUB, TEACHER, S), S)).toEqual({ kind: 'cover', substitutionId: SUB, teacherId: TEACHER });
    expect(parseAction(coverPayload(SUB, 'skip', S), S)).toEqual({ kind: 'cover', substitutionId: SUB, teacherId: 'skip' });
    expect(parseAction(ackPayload(SUB, S), S)).toEqual({ kind: 'ack', substitutionId: SUB });
  });

  it("fits Meta's limits: a quick-reply payload under 256 characters, a list row id under 200", () => {
    expect(leavePayload('approve', LEAVE, S).length).toBeLessThan(256);
    expect(coverPayload(SUB, TEACHER, S).length).toBeLessThan(200);
  });

  it('a tampered id, a wrong secret, or a foreign string is refused — never a lookup', () => {
    const good = leavePayload('approve', LEAVE, S);
    expect(parseAction(good.replace('lv:a', 'lv:r'), S)).toBeNull(); // approve → reject with the approve signature
    expect(parseAction(good.replace(LEAVE.slice(0, 4), 'dead'), S)).toBeNull();
    expect(parseAction(good, 'other-secret')).toBeNull();
    expect(parseAction('hello', S)).toBeNull();
    expect(parseAction('lv:a:x', S)).toBeNull();
    expect(parseAction('', S)).toBeNull();
  });
});
