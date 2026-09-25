import { codeFromError, failureAdvice, failureBlame } from './failure';

/**
 * The card counted every failed message as a "number to fix". On staging that
 * read as 8 numbers to chase when 7 were ours — six from an expired token and
 * one from a sender id pointing at the business account. A school ringing
 * seven parents about our environment is worse than showing nothing.
 */
describe('whose problem a WhatsApp failure is', () => {
  it('blames the setup for a lapsed or wrong connection', () => {
    expect(failureBlame(190)).toBe('SETUP');     // token expired — 6 of staging's 8
    expect(failureBlame(100)).toBe('SETUP');     // the WABA id as a sender
    expect(failureBlame(131030)).toBe('SETUP');  // still on the test allow-list
    expect(failureBlame(131058)).toBe('SETUP');  // hello_world off a public test number
  });

  it('blames the template when Meta has not approved it', () => {
    // OTP fails this way until `sckools_verify_code` exists on the account.
    expect(failureBlame(132001)).toBe('CONTENT');
    expect(failureBlame(132000)).toBe('CONTENT');
  });

  it('blames the recipient only when the phone really cannot receive it', () => {
    expect(failureBlame(131026)).toBe('RECIPIENT');  // not on WhatsApp
    expect(failureBlame(131047)).toBe('RECIPIENT');  // outside the window
  });

  it('does not guess at a code it has never seen', () => {
    expect(failureBlame(999999)).toBe('UNKNOWN');
    expect(failureBlame(null)).toBe('UNKNOWN');
  });

  it('tells the school to chase a parent ONLY when it is the parent', () => {
    for (const b of ['SETUP', 'CONTENT'] as const) {
      expect(failureAdvice(b)).toMatch(/Nothing for the school to chase/);
    }
    expect(failureAdvice('RECIPIENT')).toMatch(/check the number/);
  });

  it('reads the code back out of the reason we stored', () => {
    // The ledger keeps Meta's sentence; the code is inside it.
    expect(codeFromError("Unsupported post request. Object with ID '161…' does not exist (code 100)")).toBe(100);
    expect(codeFromError('Recipient phone number not in allowed list (code 131030)')).toBe(131030);
    expect(codeFromError('something went wrong')).toBeNull();
    expect(codeFromError(null)).toBeNull();
  });

  it('classifies staging’s real ledger the way a person would', () => {
    // The eight failures actually on the card, 25 Sep 2026.
    const real = [190, 190, 190, 190, 190, 190, 131030, 100];
    const blames = real.map(failureBlame);
    expect(blames.every((b) => b === 'SETUP')).toBe(true);
  });
});
