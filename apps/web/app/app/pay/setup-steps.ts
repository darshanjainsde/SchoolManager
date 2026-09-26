import type { Overview, SalarySettings } from './types';

export type StepState = 'done' | 'now' | 'todo';
export interface SetupStep { state: StepState; title: string; detail: string; action: { href: string; label: string } | null }

/**
 * The path a school walks before its first pay run. Shared by the Pay home
 * (where it is the hero until the first month is locked) and This month (so a
 * person who lands there mid-setup still sees where they are).
 */
export function setupSteps(o: Overview, s: SalarySettings | undefined, base: string): SetupStep[] {
  return [
    {
      // Not "done" until a state is set: professional tax and ESI thresholds
      // are decided by it, and with it unset they are silently zero.
      state: s?.region ? 'done' : 'now',
      title: 'Where the school is',
      detail: s?.region
        ? `${s.pack.label} · ${s.region}. This decides provident fund, ESI and professional tax.`
        : `${s?.pack.label ?? 'The country'} is set. The STATE is not — professional tax and ESI depend on it, and stay at zero until it is.`,
      action: s?.region ? null : { href: `${base}/settings`, label: 'Set the state' },
    },
    {
      state: o.setup.gradeCount > 0 ? 'done' : 'now',
      title: 'Make your grades',
      detail: o.setup.gradeCount > 0
        ? `${o.setup.gradeCount} ${o.setup.gradeCount === 1 ? 'grade' : 'grades'}. A grade holds the band and the split, so a person needs only a figure.`
        : `We can draft them from the ${o.setup.rosterSize} people already on your roll. Check the bands and keep the ones you want.`,
      action: { href: `${base}/grades`, label: o.setup.gradeCount > 0 ? 'Review grades' : 'Draft my grades' },
    },
    {
      state: o.setup.onPay > 0 ? 'done' : (o.setup.gradeCount > 0 ? 'now' : 'todo'),
      title: 'Put people on a grade',
      detail: o.setup.onPay > 0
        ? `${o.setup.onPay} on the payroll, ${o.setup.notOnPay} still to go.`
        : `${o.setup.rosterSize} people waiting. Pick several at once — each needs a grade and a figure.`,
      action: o.setup.gradeCount > 0 ? { href: `${base}/people`, label: 'Put people on pay' } : null,
    },
    {
      state: 'todo',
      title: 'Run the month',
      detail: 'Once anyone is on the payroll, This month becomes the month and what it costs.',
      action: null,
    },
  ];
}
