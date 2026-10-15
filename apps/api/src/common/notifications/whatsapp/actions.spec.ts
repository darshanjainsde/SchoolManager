import { createHmac } from 'node:crypto';
import { ACTION_TTL_MS, V1_ACCEPTED_UNTIL, ackAllPayload, ackPayload, actionIdentity, actionKeys, cantAllPayload, cantPayload, coverAllPayload, coverPayload, leavePayload, oneByOnePayload, parseAction } from './actions';

const K = { sign: 'k-now', verify: ['k-now'], legacy: 'meta' } as const;
const LEAVE = '11111111-1111-1111-1111-111111111111';
const SUB = '22222222-2222-2222-2222-222222222222';
const T = '33333333-3333-3333-3333-333333333333';
const NOW = Date.parse('2026-10-06T10:00:00Z');
const v1 = (body: string, secret: string) => `${body}:${createHmac('sha256', secret).update(body).digest('hex').slice(0, 12)}`;

describe('button payloads v2', () => {
  it('round-trips every action', () => {
    expect(parseAction(leavePayload('approve', LEAVE, K, NOW), K, NOW)).toEqual({ ok: true, action: { kind: 'leave', decision: 'approve', leaveId: LEAVE } });
    expect(parseAction(leavePayload('reject', LEAVE, K, NOW), K, NOW)).toEqual({ ok: true, action: { kind: 'leave', decision: 'reject', leaveId: LEAVE } });
    expect(parseAction(coverPayload(SUB, T, K, NOW), K, NOW)).toEqual({ ok: true, action: { kind: 'cover', substitutionId: SUB, teacherId: T } });
    expect(parseAction(coverPayload(SUB, 'skip', K, NOW), K, NOW)).toEqual({ ok: true, action: { kind: 'cover', substitutionId: SUB, teacherId: 'skip' } });
    expect(parseAction(ackPayload(SUB, K, NOW), K, NOW)).toEqual({ ok: true, action: { kind: 'ack', substitutionId: SUB } });
  });
  it("fits Meta's limits: under 256 for a quick reply and 200 for a list row", () => {
    expect(leavePayload('approve', LEAVE, K, NOW).length).toBeLessThan(256);
    // The cover card's two quick replies — the Can't one carries a teacher id as well.
    expect(ackPayload(SUB, K, NOW).length).toBeLessThan(256);
    expect(cantPayload(SUB, T, K, NOW).length).toBeLessThan(256);
    expect(coverPayload(SUB, T, K, NOW).length).toBeLessThan(200);
  });
  it('expires after seven days — and says so only for a payload that was genuinely ours', () => {
    const p = leavePayload('approve', LEAVE, K, NOW);
    expect(parseAction(p, K, NOW + ACTION_TTL_MS - 60_000).ok).toBe(true);
    expect(parseAction(p, K, NOW + ACTION_TTL_MS + 60_000)).toEqual({ ok: false, why: 'expired', action: { kind: 'leave', decision: 'approve', leaveId: LEAVE } });
    expect(parseAction(p.replace(LEAVE.slice(0, 4), 'dead'), K, NOW + ACTION_TTL_MS + 60_000)).toEqual({ ok: false, why: 'foreign' });
  });
  it('a moved expiry is a forgery', () => {
    const p = leavePayload('approve', LEAVE, K, NOW).split(':');
    p[p.length - 2] = 'zzzzzz';
    expect(parseAction(p.join(':'), K, NOW)).toEqual({ ok: false, why: 'foreign' });
  });
  it('rotation: a payload signed with the previous secret still works', () => {
    const old = leavePayload('approve', LEAVE, { sign: 'k-old' }, NOW);
    expect(parseAction(old, { verify: ['k-now', 'k-old'], legacy: null }, NOW).ok).toBe(true);
    expect(parseAction(old, { verify: ['k-now'], legacy: null }, NOW)).toEqual({ ok: false, why: 'foreign' });
  });
  it('v1 buttons already on phones keep working until 15 Nov 2026, then stop', () => {
    const p = v1(`lv:a:${LEAVE}`, 'meta');
    expect(parseAction(p, K, V1_ACCEPTED_UNTIL - 1)).toEqual({ ok: true, action: { kind: 'leave', decision: 'approve', leaveId: LEAVE } });
    expect(parseAction(p, K, V1_ACCEPTED_UNTIL)).toEqual({ ok: false, why: 'foreign' });
    expect(parseAction(p, { verify: ['k-now'], legacy: null }, NOW)).toEqual({ ok: false, why: 'foreign' });
  });
  it('tampering, a wrong secret or a foreign string is refused', () => {
    const good = leavePayload('approve', LEAVE, K, NOW);
    expect(parseAction(good.replace('lv:a', 'lv:r'), K, NOW).ok).toBe(false);
    expect(parseAction(good, { verify: ['other'], legacy: null }, NOW).ok).toBe(false);
    for (const s of ['', 'hello', 'v2:', 'v2:lv:a:x:1:abc', ':::::']) expect(parseAction(s, K, NOW)).toEqual({ ok: false, why: 'foreign' });
  });
  it('a signature of the right length but multi-byte characters is refused, never a throw', () => {
    const p = leavePayload('approve', LEAVE, K, NOW).split(':');
    p[p.length - 1] = 'é'.repeat(12);
    expect(parseAction(p.join(':'), K, NOW)).toEqual({ ok: false, why: 'foreign' });
    expect(parseAction(`lv:a:${LEAVE}:${'é'.repeat(12)}`, K, NOW)).toEqual({ ok: false, why: 'foreign' });
  });
});

describe('actionKeys', () => {
  it("signs with our own secret when set, and still verifies the previous one and Meta's", () => {
    const k = actionKeys({ WHATSAPP_ACTION_SECRET: 'own', WHATSAPP_ACTION_SECRET_PREV: 'prev', META_APP_SECRET: 'meta' } as NodeJS.ProcessEnv);
    expect(k).toEqual({ sign: 'own', verify: ['own', 'prev', 'meta'], legacy: 'meta' });
  });
  it("falls back to Meta's secret until ours is set", () => {
    expect(actionKeys({ META_APP_SECRET: 'meta' } as NodeJS.ProcessEnv)).toEqual({ sign: 'meta', verify: ['meta'], legacy: 'meta' });
  });
  it('with no secret at all, signs with a random key — never a public constant, never a crash', () => {
    const a = actionKeys({} as NodeJS.ProcessEnv);
    expect(a.sign).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sign).not.toBe('unset');
    expect(actionKeys({} as NodeJS.ProcessEnv).sign).toBe(a.sign); // stable within the process
  });
});

describe("the Can't button", () => {
  const keys = { sign: 'k', verify: ['k'], legacy: null };
  it('round-trips as its own action, naming the teacher the card was sent to', () => {
    expect(parseAction(cantPayload('sub-1', 't-kavya', keys), keys)).toEqual({ ok: true, action: { kind: 'cant', substitutionId: 'sub-1', teacherId: 't-kavya' } });
  });
  it('a card rendered from an older row (no substitute on it) acts for whoever covers it now', () => {
    expect(parseAction(cantPayload('sub-1', null, keys), keys)).toEqual({ ok: true, action: { kind: 'cant', substitutionId: 'sub-1', teacherId: null } });
  });
  it('expires like every other button', () => {
    const old = cantPayload('sub-1', 't-kavya', keys, Date.now() - ACTION_TTL_MS - 60_000);
    expect(parseAction(old, keys)).toMatchObject({ ok: false, why: 'expired', action: { kind: 'cant' } });
  });
  it('is never mistaken for Got it, and Got it keeps its old shape', () => {
    expect(actionIdentity(cantPayload('sub-1', 't-kavya', keys))).toBe('cn:sub-1:t-kavya');
    expect(actionIdentity(ackPayload('sub-1', keys))).toBe('ca:sub-1');
  });
  it('a tampered or malformed Can\'t is foreign', () => {
    const good = cantPayload('sub-1', 't-kavya', keys);
    expect(parseAction(good.replace('t-kavya', 't-other'), keys)).toEqual({ ok: false, why: 'foreign' });
  });
});

describe('the batch buttons — give the rest, one by one, and the summary\'s Got it / Can\'t', () => {
  const K = { sign: 'k1', verify: ['k1'], legacy: null };
  const SUB = '22222222-2222-2222-2222-222222222222';
  const LEAVE = '11111111-1111-1111-1111-111111111111';
  const T = '33333333-3333-3333-3333-333333333333';

  it('each round-trips to exactly the action it was made for', () => {
    expect(parseAction(coverAllPayload(SUB, T, K), K)).toEqual({ ok: true, action: { kind: 'coverAll', substitutionId: SUB, teacherId: T } });
    expect(parseAction(oneByOnePayload(SUB, K), K)).toEqual({ ok: true, action: { kind: 'oneByOne', substitutionId: SUB } });
    expect(parseAction(ackAllPayload(LEAVE, T, K), K)).toEqual({ ok: true, action: { kind: 'ackAll', leaveId: LEAVE, teacherId: T } });
    expect(parseAction(cantAllPayload(LEAVE, T, K), K)).toEqual({ ok: true, action: { kind: 'cantAll', leaveId: LEAVE, teacherId: T } });
  });

  it('is no longer than the cover card\'s own Can\'t, which already travels as a template button', () => {
    const cant = cantPayload(SUB, T, K).length;
    for (const p of [coverAllPayload(SUB, T, K), oneByOnePayload(SUB, K), ackAllPayload(LEAVE, T, K), cantAllPayload(LEAVE, T, K)]) expect(p.length).toBeLessThanOrEqual(cant);
  });

  it('a different teacher or leave spliced into a signed body is foreign, never acted on', () => {
    const real = ackAllPayload(LEAVE, T, K);
    const forged = real.replace(T, '44444444-4444-4444-4444-444444444444');
    expect(parseAction(forged, K)).toEqual({ ok: false, why: 'foreign' });
    expect(parseAction(cantAllPayload(LEAVE, T, { sign: 'someone-else' }), K)).toEqual({ ok: false, why: 'foreign' });
  });

  it('expires like every other button, and says which action expired', () => {
    const old = Date.now() - ACTION_TTL_MS - 60_000;
    expect(parseAction(coverAllPayload(SUB, T, K, old), K)).toEqual({ ok: false, why: 'expired', action: { kind: 'coverAll', substitutionId: SUB, teacherId: T } });
  });

  it('a malformed body (missing the teacher) is foreign even when signed', () => {
    const seal = (body: string) => {
      // Re-sign a hand-made body the same way the module does, to prove the SHAPE check, not the signature, refuses it.
      const exp = Math.floor((Date.now() + ACTION_TTL_MS) / 60_000).toString(36);
      const head = `v2:${body}:${exp}`;
      return `${head}:${createHmac('sha256', 'k1').update(head).digest('hex').slice(0, 12)}`;
    };
    expect(parseAction(seal(`ba:${LEAVE}`), K)).toEqual({ ok: false, why: 'foreign' });
    expect(parseAction(seal(`cb:${SUB}`), K)).toEqual({ ok: false, why: 'foreign' });
    expect(parseAction(seal(`ob:${SUB}:${T}`), K)).toEqual({ ok: false, why: 'foreign' });
  });
});
