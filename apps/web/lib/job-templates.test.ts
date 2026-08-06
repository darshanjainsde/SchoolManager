import { describe, it, expect } from 'vitest';
import { JOB_TEMPLATES, templateFits } from './job-templates';
import { MAX_QUESTIONS, isFilterable } from './jobs-admin';

/**
 * A TEMPLATE THAT BREAKS THE RULES IS A TRAP.
 *
 * The service refuses a fifth question and the desk cannot filter free text.
 * A starting point that violated either would hand a school a vacancy that
 * fails on save, or an applications list they cannot sort — which is worse than
 * the blank form it replaced.
 */
describe('every template fits the rules the service enforces', () => {
  it.each(JOB_TEMPLATES.map((t) => [t.label, t] as const))('%s asks at most four questions', (_l, t) => {
    expect(t.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(templateFits(t)).toBe(true);
  });

  it.each(JOB_TEMPLATES.map((t) => [t.label, t] as const))('%s asks only filterable questions', (_l, t) => {
    // The whole point of the cap is that every answer sorts the pile. A
    // template shipping free text would spend a quarter of the budget on
    // something the desk cannot act on.
    for (const q of t.questions) expect(isFilterable(q.kind)).toBe(true);
  });

  it.each(JOB_TEMPLATES.map((t) => [t.label, t] as const))('%s gives every CHOICE something to choose', (_l, t) => {
    for (const q of t.questions) {
      if (q.kind === 'CHOICE') expect(q.options.length).toBeGreaterThan(1);
    }
  });
});

describe('the list itself', () => {
  it('covers the roles a school actually hires for, and ends with a blank', () => {
    expect(JOB_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(JOB_TEMPLATES.at(-1)?.value).toBe('BLANK');
  });

  it('starts blank truly blank — no prose to delete before writing your own', () => {
    const blank = JOB_TEMPLATES.find((t) => t.value === 'BLANK')!;
    expect(blank.fields.title).toBe('');
    expect(blank.fields.description).toBe('');
    expect(blank.questions).toEqual([]);
  });

  it('names no school and invents no salary', () => {
    // A template that carried a number would be quoted back at a school by a
    // candidate. Pay is theirs to state.
    for (const t of JOB_TEMPLATES) {
      expect(JSON.stringify(t.fields)).not.toMatch(/₹|\bsalary\b/i);
    }
  });
});
