import { ALL_TABS, FEES_TAB, VISIBLE_TABS, visibleTabs } from '../family-nav';

describe('the fifth tab', () => {
  it('draws four tabs for a school without fees and five with it, fees in the middle', () => {
    expect(visibleTabs(undefined).map((t) => t.name)).toEqual(['home', 'attendance', 'results', 'profile']);
    expect(visibleTabs([]).map((t) => t.name)).toEqual(['home', 'attendance', 'results', 'profile']);
    expect(visibleTabs(['LIBRARY']).map((t) => t.name)).toEqual(['home', 'attendance', 'results', 'profile']);
    expect(visibleTabs(['FEES']).map((t) => t.name)).toEqual(['home', 'attendance', 'fees', 'results', 'profile']);
  });
  it('registers every tab file whether or not the bar draws it', () => {
    expect(ALL_TABS).toContain(FEES_TAB);
    expect(ALL_TABS.length).toBe(VISIBLE_TABS.length + 1);
  });
});
