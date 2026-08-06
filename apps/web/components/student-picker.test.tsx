import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StudentPicker, labelFor } from './student-picker';

/**
 * TWO CHILDREN CAN SHARE A NAME EXACTLY.
 *
 * The match list always carried the roll number, but a chip — the thing a
 * teacher looks at while writing a remark and then sends — showed the name
 * alone. Two pupils called the same thing became two identical chips, and the
 * teacher had no way to tell which child the remark was about. That is a
 * mistake that reaches a family.
 */
const TWINS = [
  { id: 's1', name: 'Aarav Sharma', rollNo: '12' },
  { id: 's2', name: 'Aarav Sharma', rollNo: '19' },
  { id: 's3', name: 'Diya Patel', rollNo: null },
];

describe('picking between two pupils with the same name', () => {
  it('tells the chips apart by roll number', () => {
    render(<StudentPicker students={TWINS} selected={['s1', 's2']} onChange={vi.fn()} />);
    const tokens = screen.getByTestId('picker-tokens');
    expect(within(tokens).getByTestId('token-s1').textContent).toContain('12');
    expect(within(tokens).getByTestId('token-s2').textContent).toContain('19');
  });

  it('names the roll in the remove control too, so a screen reader can tell them apart', () => {
    render(<StudentPicker students={TWINS} selected={['s1', 's2']} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove Aarav Sharma, roll 12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Aarav Sharma, roll 19' })).toBeInTheDocument();
  });

  it('still shows the name for a pupil with no roll number on file', () => {
    render(<StudentPicker students={TWINS} selected={['s3']} onChange={vi.fn()} />);
    expect(screen.getByTestId('token-s3').textContent).toContain('Diya Patel');
    expect(screen.getByRole('button', { name: 'Remove Diya Patel' })).toBeInTheDocument();
  });
});

describe('labelFor', () => {
  it('carries the roll when there is one', () => {
    expect(labelFor({ name: 'Aarav Sharma', rollNo: '12' })).toBe('Aarav Sharma, roll 12');
  });

  it('does not invent one when there is not', () => {
    expect(labelFor({ name: 'Diya Patel', rollNo: null })).toBe('Diya Patel');
  });
});
