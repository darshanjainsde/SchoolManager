import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Users } from 'lucide-react';
import { HubDoor, HubDoors, HubKpi, HubKpis, HubList, HubPage } from './hub';
import { Cell, Row, RowTitle } from './kit';

describe('HubPage', () => {
  it('renders the title, the subtitle under it, and the action beside them', () => {
    render(
      <HubPage title="Fees" subtitle="What has come in." action={<a href="/x" className="sk-btn">Do it</a>}>
        <p>body</p>
      </HubPage>,
    );
    const head = screen.getByRole('banner');
    const title = head.querySelector('.sk-hubtitle')!;
    expect(within(title as HTMLElement).getByRole('heading', { level: 1 })).toHaveTextContent('Fees');
    expect(title.querySelector('p')).toHaveTextContent('What has come in.');
    // The action is NOT inside the title column — it sits beside it.
    expect(title.contains(screen.getByRole('link', { name: 'Do it' }))).toBe(false);
    expect(head.contains(screen.getByRole('link', { name: 'Do it' }))).toBe(true);
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('renders no action slot when there is no action', () => {
    const { container } = render(<HubPage title="T" subtitle="S"><i /></HubPage>);
    expect(container.querySelector('.sk-hubact')).toBeNull();
  });
});

describe('HubKpi', () => {
  it('is a link when given a href, a plain tile otherwise, and carries its tone', () => {
    render(
      <HubKpis>
        <HubKpi href="/app/fees/verify" label="Waiting for you" value={3} hint="₹51,300 to confirm" tone="warn" />
        <HubKpi label="Next delivery" value="10 Sept" />
      </HubKpis>,
    );
    const link = screen.getByRole('link', { name: /Waiting for you/ });
    expect(link).toHaveAttribute('href', '/app/fees/verify');
    expect(link).toHaveAttribute('data-tone', 'warn');
    expect(link).toHaveTextContent('₹51,300 to confirm');
    expect(screen.getByText('Next delivery').closest('.sk-kpi')!.tagName).toBe('DIV');
  });
});

describe('HubDoor', () => {
  it('is a link with a href and a button with an onClick; name and meta are separate blocks', () => {
    const onClick = vi.fn();
    render(
      <HubDoors>
        <HubDoor href="/app/fees/students" icon={Users} tint="#000" title="Fees by student" meta="Everyone on the roll" />
        <HubDoor onClick={onClick} icon={Users} tint="#000" title="Anything on paper" meta="quote first" />
      </HubDoors>,
    );
    const link = screen.getByRole('link', { name: /Fees by student/ });
    expect(link).toHaveAttribute('href', '/app/fees/students');
    expect(link.querySelector('.nm')).toHaveTextContent('Fees by student');
    expect(link.querySelector('.meta')).toHaveTextContent('Everyone on the roll');
    // Two separate elements, wrapped in the block that the stylesheet stacks — never one run-together line.
    expect(link.querySelector('.nm')).not.toBe(link.querySelector('.meta'));
    expect(link.querySelector('.sk-hubdoor-text')!.children).toHaveLength(2);
    screen.getByRole('button', { name: /Anything on paper/ }).click();
    expect(onClick).toHaveBeenCalled();
  });
});

describe('HubList', () => {
  it('renders the rows in one RowList that owns the column tracks, with the "more" link', () => {
    render(
      <HubList title="Latest payments" label="Latest payments" more={{ href: '/app/fees/verify', label: 'All' }} columns="minmax(0,1fr) auto" count={2} empty="none">
        <Row><Cell><RowTitle title="Aarav Mehta" sub="7 B" /></Cell><Cell align="end">₹18,500</Cell></Row>
        <Row><Cell><RowTitle title="Saanvi Krishnamurthy" sub="3 A" /></Cell><Cell align="end">₹12,600</Cell></Row>
      </HubList>,
    );
    const list = screen.getByRole('list', { name: 'Latest payments' });
    expect(list).toHaveStyle({ '--sk-row-cols': 'minmax(0,1fr) auto' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'All →' })).toHaveAttribute('href', '/app/fees/verify');
  });
  it('says so in one line when there is nothing, instead of drawing an empty table', () => {
    render(<HubList title="Imports" label="Imports" columns="1fr" count={0} empty="No file has been imported yet." />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('No file has been imported yet.')).toBeInTheDocument();
  });
});
