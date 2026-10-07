import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateField, autoSlash, displayOf, parseIso, parseTyped } from './date-field';

function Harness({ initial = '', onChange = vi.fn(), ...rest }: { initial?: string; onChange?: (v: string) => void; min?: string; max?: string; openTo?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <label htmlFor="d">Date of birth</label>
      <DateField id="d" value={v} onChange={(x) => { setV(x); onChange(x); }} {...rest} />
      <button type="button">elsewhere</button>
    </>
  );
}

describe('reading what an office types', () => {
  it.each([
    ['14/09/1999', '1999-09-14'],
    ['14-9-1999', '1999-09-14'],
    ['14.09.1999', '1999-09-14'],
    ['14091999', '1999-09-14'],
    ['1999-09-14', '1999-09-14'],
  ])('%p → %p (day first)', (t, iso) => expect(parseTyped(t)).toBe(iso));
  it.each(['31/02/2020', '00/01/2020', '14/13/1999', 'yesterday', '14/09/99'])('%p is not a date', (t) => expect(parseTyped(t)).toBeNull());
  it('29 Feb only in a leap year', () => { expect(parseIso('2024-02-29')).not.toBeNull(); expect(parseIso('2023-02-29')).toBeNull(); });
  it('puts the slashes in as digits arrive, and leaves other shapes alone', () => {
    expect(autoSlash('14')).toBe('14');
    expect(autoSlash('1409')).toBe('14/09');
    expect(autoSlash('14091999')).toBe('14/09/1999');
    expect(autoSlash('140919991')).toBe('14/09/1999');
    expect(autoSlash('1999-09-14')).toBe('1999-09-14');
  });
  it('shows a stored date the Indian way', () => expect(displayOf('1999-09-14')).toBe('14/09/1999'));
});

describe('the date field', () => {
  it('typing eight digits gives the date; leaving the field saves it as YYYY-MM-DD', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Date of birth');
    await user.type(input, '14091999');
    expect(input).toHaveValue('14/09/1999');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('1999-09-14');
  });

  it('a date that does not exist is held, marked, and explained — never silently dropped or saved', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Date of birth');
    await user.type(input, '31022020');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('31/02/2020');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Type the date as dd\/mm\/yyyy/)).toBeInTheDocument();
  });

  it('a date after the latest allowed is refused the same way', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} max="2008-12-31" />);
    await user.type(screen.getByLabelText('Date of birth'), '01012010');
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/no later than 31\/12\/2008/)).toBeInTheDocument();
  });

  it('emptying the field clears the date', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness initial="1999-09-14" onChange={onChange} />);
    await user.clear(screen.getByLabelText('Date of birth'));
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('the calendar picks a year and a month from lists, then a day — a date of birth in three choices', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} openTo="1990-01" />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a date' });
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveValue('1990');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '1987');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), '2');
    await user.click(screen.getByRole('gridcell', { name: '14 March 1987' }));
    expect(onChange).toHaveBeenLastCalledWith('1987-03-14');
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByLabelText('Date of birth')).toHaveValue('14/03/1987');
    expect(screen.getByLabelText('Date of birth')).toHaveFocus();
  });

  /**
   * THE REGRESSION (2026-10-07, on prod): the calendar is portalled to <body>,
   * outside the console's `.skosx` wrapper, where every --sk-* colour token is
   * undefined — it opened with no background and faint text, see-through over
   * the form. It must carry the theme scope itself, above the page chrome.
   */
  it('the open calendar carries the console theme and sits above the page', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial="2026-10-07" />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a date' });
    expect(dialog.closest('.skosx')).not.toBeNull();
    expect(dialog.parentElement).toBe(document.body);
    expect(Number(dialog.style.zIndex)).toBeGreaterThanOrEqual(80);
  });

  it('opens on the stored month, Monday first, with the stored day selected', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial="2026-10-07" />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    expect(screen.getByRole('gridcell', { name: '7 October 2026' })).toHaveAttribute('aria-selected', 'true');
  });

  it('days outside the allowed range cannot be picked, and the year list stops at the bounds', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial="2008-12-15" min="1950-01-01" max="2008-12-20" />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    expect(screen.getByRole('gridcell', { name: '21 December 2008' })).toBeDisabled();
    expect(screen.getByRole('gridcell', { name: '20 December 2008' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
    const years = [...(screen.getByRole('combobox', { name: 'Year' }) as HTMLSelectElement).options].map((o) => o.value);
    expect(years[0]).toBe('2008');
    expect(years[years.length - 1]).toBe('1950');
  });

  it('the keyboard walks the days, and Escape closes back to the field', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness initial="2026-10-07" onChange={onChange} />);
    screen.getByLabelText('Date of birth').focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('gridcell', { name: '7 October 2026' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(screen.getByRole('gridcell', { name: '15 October 2026' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Clear empties a set date; a click outside closes without changing it', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness initial="2026-10-07" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByLabelText('Date of birth')).toHaveValue('');
  });

  it('a new value from outside replaces what is shown', () => {
    const { rerender } = render(<DateField id="d" value="2020-01-05" onChange={vi.fn()} aria-label="d" />);
    expect(screen.getByLabelText('d')).toHaveValue('05/01/2020');
    rerender(<DateField id="d" value="" onChange={vi.fn()} aria-label="d" />);
    expect(screen.getByLabelText('d')).toHaveValue('');
  });

  /**
   * WHERE IT OPENS ON A PHONE. A static snapshot cannot show placement, so it
   * is asserted here with phone geometry: a 360x640 window, the field in the
   * right-hand column, or near the bottom of a long form.
   */
  describe('placement on a phone', () => {
    const setWindow = (w: number, h: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    };
    const rect = (left: number, top: number, width = 150, height = 40) =>
      ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    async function openAt(r: DOMRect) {
      const user = userEvent.setup({ delay: null });
      render(<Harness initial="1999-09-14" />);
      vi.spyOn(screen.getByLabelText('Date of birth'), 'getBoundingClientRect').mockReturnValue(r);
      await user.click(screen.getByRole('button', { name: 'Open calendar' }));
      return screen.getByRole('dialog', { name: 'Choose a date' });
    }

    it('a field in the right-hand column of a 360px phone: the calendar is pulled in, 16px from the edge, never past it', async () => {
      setWindow(360, 640);
      const d = await openAt(rect(196, 120));
      const left = parseFloat(d.style.left), width = parseFloat(d.style.width);
      expect(width).toBeLessThanOrEqual(360 - 32);
      expect(left).toBeGreaterThanOrEqual(16);
      expect(left + width).toBeLessThanOrEqual(360 - 16);
      expect(parseFloat(d.style.top)).toBe(120 + 40 + 6);
    });

    it('a 320px phone: the calendar narrows to the window, 16px each side', async () => {
      setWindow(320, 568);
      const d = await openAt(rect(16, 100, 288));
      expect(parseFloat(d.style.width)).toBe(288);
      expect(parseFloat(d.style.left)).toBe(16);
    });

    it('a field near the bottom of the screen: the calendar opens upward, above the field', async () => {
      setWindow(390, 700);
      const d = await openAt(rect(20, 600));
      expect(d.style.top).toBe('');
      expect(parseFloat(d.style.bottom)).toBe(700 - 600 + 6);
    });

    it('a desktop: it opens under the field, at its full 304px', async () => {
      setWindow(1440, 900);
      const d = await openAt(rect(600, 300, 260));
      expect(parseFloat(d.style.width)).toBe(304);
      expect(parseFloat(d.style.left)).toBe(600);
      expect(parseFloat(d.style.top)).toBe(346);
    });
  });
});
