import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeManager, { liveTemplateId, scheduledNow, type TemplateRow } from './theme-manager';

/**
 * TWO QUESTIONS, ANSWERED IN WORDS: what do visitors see, and how do I change
 * it. The old card mixed "Live site" into the theme list and the user could
 * not say which design was live (2026-09-27).
 */
const pick = (c: Record<string, unknown>) => ({ brandColorPrimary: c.brandColorPrimary, festiveTheme: c.festiveTheme ?? null });
const T = (o: Partial<TemplateRow> & { id: string; name: string }): TemplateRow => ({
  config: {}, publishAt: null, revertAt: null, updatedAt: '2026-09-01T00:00:00Z', ...o,
});
const diwali = T({ id: 'd', name: 'Diwali edition', config: { brandColorPrimary: '#f80', festiveTheme: { festival: 'DIWALI' } } });
const plain = T({ id: 'p', name: 'Default', config: { brandColorPrimary: '#036' } });
const noop = { onOpen: vi.fn(), onBackToTemplates: vi.fn(), onSave: vi.fn(), onDiscard: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(), onMakeLive: vi.fn(), onCreate: vi.fn(), onSchedule: vi.fn() };
const base = { pickLook: pick, unsavedIds: new Set<string>(), dirty: false, navErrors: [], busy: {}, now: new Date('2026-09-27T06:00:00Z'), ...noop };

describe('which template is live', () => {
  it('is decided by content: the template whose saved design equals the live design', () => {
    expect(liveTemplateId([diwali, plain], { brandColorPrimary: '#f80', festiveTheme: { festival: 'DIWALI' }, phone: 'ignored' }, pick)).toBe('d');
    expect(liveTemplateId([diwali, plain], { brandColorPrimary: '#000' }, pick)).toBeNull();
  });
  it('says it in the Live card and badges the row', () => {
    render(<ThemeManager {...base} templates={[diwali, plain]} liveLook={diwali.config} activeId="p" />);
    expect(screen.getByTestId('live-now')).toHaveTextContent('Visitors see Diwali edition.');
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('LIVE')).toBeTruthy();
    expect(within(rows[1]).queryByText('LIVE')).toBeNull();
  });
  it('with no templates, the only door is "save the live design as a template"', async () => {
    const onCreate = vi.fn();
    render(<ThemeManager {...base} onCreate={onCreate} templates={[]} liveLook={{ brandColorPrimary: '#036' }} activeId={null} />);
    expect(screen.getByTestId('templates-empty')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /save the live design as a template/i }));
    expect(onCreate).toHaveBeenCalledWith('Current design', 'live');
  });
});

describe('putting a template live', () => {
  it('is one select and one button, and the button is off while the choice is already live', async () => {
    const onMakeLive = vi.fn();
    render(<ThemeManager {...base} onMakeLive={onMakeLive} templates={[diwali, plain]} liveLook={diwali.config} activeId="d" />);
    const select = screen.getByLabelText(/put a template live/i) as HTMLSelectElement;
    // Defaults to the one that is NOT live, so the button is ready to press.
    expect(select.value).toBe('p');
    await userEvent.click(screen.getByRole('button', { name: 'Make live' }));
    expect(onMakeLive).toHaveBeenCalledWith('p');
    await userEvent.selectOptions(select, 'd');
    expect(screen.getByRole('button', { name: 'Make live' })).toBeDisabled();
  });
  it('a template with unsaved edits cannot be put live from its editor — save first', () => {
    render(<ThemeManager {...base} templates={[diwali, plain]} liveLook={diwali.config} activeId="p" dirty unsavedIds={new Set(['p'])} />);
    const editor = screen.getByText('Editing').parentElement!;
    expect(within(editor).getByRole('button', { name: 'Make live' })).toBeDisabled();
    expect(screen.getByText(/unsaved edits — save it first/i)).toBeTruthy();
  });
});

describe('a scheduled template', () => {
  const holi = T({ id: 'h', name: 'Holi', publishAt: '2026-03-01T00:00:00Z', revertAt: null, config: { brandColorPrimary: '#f0f' } });
  it('whose window contains now is what visitors actually see, and the card says so', () => {
    expect(scheduledNow([holi, plain], new Date('2026-09-27T06:00:00Z'))?.id).toBe('h');
    render(<ThemeManager {...base} templates={[holi, plain]} liveLook={plain.config} activeId="p" />);
    const alert = screen.getByTestId('schedule-overlay');
    expect(alert).toHaveTextContent('Right now the website shows Holi with no end date');
    expect(within(alert).getByRole('button', { name: /remove schedule/i })).toBeTruthy();
  });
  it('is not shown as overriding once its window has closed', () => {
    const over = { ...holi, revertAt: '2026-03-08T00:00:00Z' };
    expect(scheduledNow([over], new Date('2026-09-27T06:00:00Z'))).toBeNull();
  });
});
