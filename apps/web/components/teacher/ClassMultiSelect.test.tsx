import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MyClassSection } from '@skoolos/types';
import { ClassMultiSelect } from './ClassMultiSelect';

function section(overrides: Partial<MyClassSection> = {}): MyClassSection {
  return { classSectionId: 'sec-1', name: '8-A', studentCount: 30, covering: false, ...overrides };
}

describe('ClassMultiSelect', () => {
  it('renders one control per class with its name', () => {
    const classes = [section({ classSectionId: 'sec-1', name: '8-A' }), section({ classSectionId: 'sec-2', name: '9-B' })];
    render(<ClassMultiSelect classes={classes} selected={[]} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '8-A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '9-B' })).toBeInTheDocument();
  });

  it('clicking an unselected class adds its id; clicking a selected one removes it', async () => {
    const user = userEvent.setup();
    const classes = [section({ classSectionId: 'sec-1', name: '8-A' }), section({ classSectionId: 'sec-2', name: '9-B' })];
    const onChange = vi.fn();
    const { rerender } = render(
      <ClassMultiSelect classes={classes} selected={[]} onChange={onChange} />,
    );

    await user.click(screen.getByRole('button', { name: '8-A' }));
    expect(onChange).toHaveBeenLastCalledWith(['sec-1']);

    rerender(<ClassMultiSelect classes={classes} selected={['sec-1']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '8-A' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('selected classes are visually distinguishable via aria-pressed', () => {
    const classes = [section({ classSectionId: 'sec-1', name: '8-A' }), section({ classSectionId: 'sec-2', name: '9-B' })];
    render(<ClassMultiSelect classes={classes} selected={['sec-1']} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '8-A' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '9-B' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('an empty classes array renders an empty state, not a bare container', () => {
    render(<ClassMultiSelect classes={[]} selected={[]} onChange={vi.fn()} />);

    expect(screen.getByText('No classes to choose from.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disabled prevents toggling', async () => {
    const user = userEvent.setup();
    const classes = [section({ classSectionId: 'sec-1', name: '8-A' })];
    const onChange = vi.fn();
    render(<ClassMultiSelect classes={classes} selected={[]} onChange={onChange} disabled />);

    const chip = screen.getByRole('button', { name: '8-A' });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a count of how many are selected', () => {
    const classes = [section({ classSectionId: 'sec-1', name: '8-A' }), section({ classSectionId: 'sec-2', name: '9-B' })];
    render(<ClassMultiSelect classes={classes} selected={['sec-1']} onChange={vi.fn()} />);

    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
  });
});
