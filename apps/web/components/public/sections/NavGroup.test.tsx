import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NavGroup from './NavGroup';
import type { NavNode } from './nav-model';

/**
 * A MENU A KEYBOARD CANNOT REACH IS A MENU A THIRD OF VISITORS DO NOT HAVE.
 *
 * The old Academics dropdown was a CSS `:hover` rule on a link. That fails three
 * ways: a keyboard can never open it, a touch device has no hover at all (the
 * first tap navigates away and the menu is never seen), and a screen reader is
 * told nothing about a menu existing. This is the control that replaces it.
 *
 * The group that is ALSO a page (Academics) is deliberately still a button —
 * the page is a row inside the menu, not the control. That is what makes the
 * first tap on a phone open the menu rather than navigate away from it.
 */

const OUR_SCHOOL: Extract<NavNode, { kind: 'group' }> = {
  kind: 'group',
  key: 'our-school',
  label: 'Our school',
  children: [
    { key: 'about', label: 'About', href: '#about' },
    { key: 'gallery', label: 'Gallery', href: '/gallery' },
  ],
};

const ACADEMICS: Extract<NavNode, { kind: 'group' }> = {
  kind: 'group',
  key: 'academics',
  label: 'Academics',
  href: '/academics',
  children: [
    { key: 'course-c1', label: 'Preschool', href: '/academics#course-c1', hint: '3–5 yrs' },
    { key: 'course-c2', label: 'Primary', href: '/academics#course-c2', hint: null },
  ],
};

function trigger(label: string) {
  return screen.getByRole('button', { name: new RegExp(label, 'i') });
}

describe('the group control', () => {
  it('is a button that says it is closed, and hides its children until it opens', () => {
    render(<NavGroup node={OUR_SCHOOL} />);
    expect(trigger('Our school')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Gallery' })).not.toBeInTheDocument();
  });

  it('opens on click and lists every child', async () => {
    const user = userEvent.setup();
    render(<NavGroup node={OUR_SCHOOL} />);
    await user.click(trigger('Our school'));
    expect(trigger('Our school')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '#about');
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute('href', '/gallery');
  });

  it('opens on hover, because that is what a mouse expects of a nav', async () => {
    const user = userEvent.setup();
    render(<NavGroup node={OUR_SCHOOL} />);
    await user.hover(trigger('Our school'));
    expect(trigger('Our school')).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens when a keyboard tabs onto it', async () => {
    const user = userEvent.setup();
    render(<NavGroup node={OUR_SCHOOL} />);
    await user.tab();
    expect(trigger('Our school')).toHaveFocus();
    expect(trigger('Our school')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and hands focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<NavGroup node={OUR_SCHOOL} />);
    await user.click(trigger('Our school'));
    await user.keyboard('{Escape}');
    expect(trigger('Our school')).toHaveAttribute('aria-expanded', 'false');
    expect(trigger('Our school')).toHaveFocus();
  });
});

describe('a group that is also a page', () => {
  it('keeps the page reachable as a row in the menu, never as the control', async () => {
    const user = userEvent.setup();
    render(<NavGroup node={ACADEMICS} />);
    // The control itself must not navigate — on a phone that first tap is the
    // only chance the visitor gets to see the menu.
    expect(screen.queryByRole('link', { name: 'Academics' })).not.toBeInTheDocument();
    await user.click(trigger('Academics'));
    expect(screen.getByRole('link', { name: /all of academics/i })).toHaveAttribute('href', '/academics');
  });

  it('shows each programme with its age range', async () => {
    const user = userEvent.setup();
    render(<NavGroup node={ACADEMICS} />);
    await user.click(trigger('Academics'));
    expect(screen.getByRole('link', { name: /Preschool/ })).toHaveAttribute('href', '/academics#course-c1');
    expect(screen.getByText('3–5 yrs')).toBeInTheDocument();
  });
});
