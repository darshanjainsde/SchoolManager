import {
  CONTACT_OUTCOMES, DESK_SOURCES, ENQUIRY_SOURCES, ENQUIRY_SOURCE_LABEL, PUBLIC_SOURCES, STAGE_ORDER,
  contactTarget, forwardStages, stageMove,
} from './pipeline';

/**
 * One road, walked forward. These rules are read by the API (which refuses a
 * backward move with 409) and by the desk (which only draws the moves the API
 * will take), so a test here is a test of both.
 */
describe('where a lead may go next', () => {
  it('puts INTERESTED between Contacted and Visited', () => {
    expect(STAGE_ORDER).toEqual(['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED']);
  });

  it('moves forward, including a jump over a stage', () => {
    expect(stageMove('NEW', 'CONTACTED')).toBe('FORWARD');
    expect(stageMove('CONTACTED', 'VISITED')).toBe('FORWARD');
    expect(stageMove('NEW', 'ENROLLED')).toBe('FORWARD');
  });

  it('refuses every step backwards', () => {
    expect(stageMove('VISITED', 'CONTACTED')).toBe('BACKWARDS');
    expect(stageMove('ENROLLED', 'NEW')).toBe('BACKWARDS');
    expect(stageMove('INTERESTED', 'CONTACTED')).toBe('BACKWARDS');
  });

  it('lets a lead be lost from any stage — an enrolled family can still withdraw', () => {
    for (const from of [...STAGE_ORDER, 'CLOSED'] as const) expect(stageMove(from, 'LOST')).toBe('LOSE');
  });

  it('reopens a lost lead to Contacted and nowhere else', () => {
    expect(stageMove('LOST', 'CONTACTED')).toBe('REOPEN');
    expect(stageMove('CLOSED', 'CONTACTED')).toBe('REOPEN');
    expect(stageMove('LOST', 'VISITED')).toBe('BACKWARDS');
    expect(stageMove('LOST', 'NEW')).toBe('BACKWARDS');
  });

  it('never writes the retired CLOSED', () => {
    expect(stageMove('NEW', 'CLOSED')).toBe('BACKWARDS');
    expect(stageMove('LOST', 'CLOSED')).toBe('BACKWARDS');
  });

  it('calls an unchanged stage SAME, so a repeated click is not a 409', () => {
    expect(stageMove('VISITED', 'VISITED')).toBe('SAME');
  });

  it('lists only the stages ahead, and none for a lost lead', () => {
    expect(forwardStages('CONTACTED')).toEqual(['INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED']);
    expect(forwardStages('ENROLLED')).toEqual([]);
    expect(forwardStages('LOST')).toEqual([]);
    expect(forwardStages('CLOSED')).toEqual([]);
  });
});

describe('what a logged call does to the stage', () => {
  it('a first contact moves NEW to Contacted', () => {
    expect(contactTarget('NEW')).toBe('CONTACTED');
    expect(contactTarget('NEW', 'CONTACTED')).toBe('CONTACTED');
  });

  it('a call nobody answered moves nothing — the family was not contacted', () => {
    expect(contactTarget('NEW', 'NO_ANSWER')).toBeNull();
    expect(contactTarget('CONTACTED', 'NO_ANSWER')).toBeNull();
  });

  it('Interested moves forward to Interested, never backwards', () => {
    expect(contactTarget('NEW', 'INTERESTED')).toBe('INTERESTED');
    expect(contactTarget('CONTACTED', 'INTERESTED')).toBe('INTERESTED');
    expect(contactTarget('VISITED', 'INTERESTED')).toBeNull();
  });

  it('Lost loses an open lead and leaves a lost one alone', () => {
    expect(contactTarget('INTERESTED', 'LOST')).toBe('LOST');
    expect(contactTarget('LOST', 'LOST')).toBeNull();
  });

  it('a contact on a lead already past New leaves the stage alone', () => {
    expect(contactTarget('VISITED')).toBeNull();
    expect(contactTarget('LOST', 'CONTACTED')).toBeNull();
  });

  it('offers the four answers the WhatsApp buttons will offer in Tier B', () => {
    expect(CONTACT_OUTCOMES).toEqual(['CONTACTED', 'INTERESTED', 'NO_ANSWER', 'LOST']);
  });
});

describe('where a lead came from', () => {
  it('lets the public form claim only the two website doors, and the desk only walk-in and phone', () => {
    for (const s of [...PUBLIC_SOURCES, ...DESK_SOURCES]) expect(ENQUIRY_SOURCES).toContain(s);
    expect(PUBLIC_SOURCES).toEqual(['WEBSITE', 'COURSE_CARD']);
    expect(DESK_SOURCES).toEqual(['WALK_IN', 'PHONE']);
  });

  it('names every source in plain words', () => {
    for (const s of ENQUIRY_SOURCES) expect(ENQUIRY_SOURCE_LABEL[s]).toMatch(/^[A-Z][A-Za-z -]+$/);
    expect(ENQUIRY_SOURCE_LABEL.WALK_IN).toBe('Walk-in');
  });
});
