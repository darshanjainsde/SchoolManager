import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HowPayWorks, HowPayWorksLink, HOW_PAY_WORKS_STEPS, HOW_PAY_WORKS_TABS } from './how-pay-works';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

function stubMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: reduced && q.includes('reduced-motion'), media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => { stubMotion(false); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('How Pay works — the script', () => {
  it('covers every one of the six tabs, in the order a school meets them', () => {
    // The walkthrough exists to show the WHOLE room. A step list that skips a
    // tab teaches the admin that the tab does not matter.
    const labels = HOW_PAY_WORKS_TABS.map((t) => t.label);
    expect(labels).toEqual(['This month', 'People', 'Grades', 'Payslips', 'Filings', 'Settings']);
    for (const t of HOW_PAY_WORKS_TABS) {
      expect(HOW_PAY_WORKS_STEPS.some((s) => s.tab === t.key), `no step ever shows ${t.label}`).toBe(true);
    }
    // Settings first: state decides provident fund, ESI and professional tax,
    // and with it unset they are silently zero.
    expect(HOW_PAY_WORKS_STEPS[0].tab).toBe('settings');
    expect(HOW_PAY_WORKS_STEPS.at(-1)!.c).toMatch(/Next month is one button/);
  });

  it('carries every figure as literal text — nothing is computed on a timer', () => {
    // A stalled animation can strand a value that was never true (ledger:
    // raf-counter-strands-wrong-number). The figures a school will read are
    // written into the script as strings, not produced by a tween.
    const captions = HOW_PAY_WORKS_STEPS.map((s) => s.c).join(' ');
    expect(captions).toContain('₹27,36,000');
    expect(captions).toContain('₹30,000');
    expect(captions).toContain('₹46,000');
    expect(captions).toContain('72');
  });
});

describe('How Pay works — on the page', () => {
  it('renders every scene as a storyboard before the script picks one', () => {
    // Nothing is hidden waiting for JavaScript: the six tab labels and the
    // content of every scene are in the DOM from the first render.
    render(<HowPayWorks base="/app/pay" onHide={() => {}} />);
    const stage = screen.getByLabelText('How Pay works');
    for (const label of ['This month', 'People', 'Grades', 'Payslips', 'Filings', 'Settings']) {
      expect(within(stage).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(stage).getByText('Provident fund (ECR)')).toBeInTheDocument();
    expect(within(stage).getByText('October 2026 · 72 payslips')).toBeInTheDocument();
    expect(within(stage).getByText('Drafted from your roll')).toBeInTheDocument();
  });

  it('lists all seventeen steps, and jumping to one marks it current', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<HowPayWorks base="/app/pay" onHide={() => {}} />);
    const list = screen.getByLabelText('Steps');
    expect(within(list).getAllByRole('button')).toHaveLength(HOW_PAY_WORKS_STEPS.length);

    await user.click(within(list).getByRole('button', { name: 'Filings, ready to upload' }));
    expect(within(list).getByRole('button', { name: 'Filings, ready to upload' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/Submitting stays with your school and its accountant/)).toBeInTheDocument();
  });

  it('autoplays with motion, and only offers Play under reduced motion', () => {
    render(<HowPayWorks base="/app/pay" onHide={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('does not autoplay under prefers-reduced-motion', () => {
    stubMotion(true);
    render(<HowPayWorks base="/app/pay" onHide={() => {}} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('Hide asks the parent, and the link brings it back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onHide = vi.fn(); const onShow = vi.fn();
    render(<><HowPayWorks base="/app/pay" onHide={onHide} /><HowPayWorksLink onShow={onShow} /></>);
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(onHide).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'How this works' }));
    expect(onShow).toHaveBeenCalled();
  });
});
