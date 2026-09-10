import { DEFAULT_SPORTS_PERMS, SPORTS_PERMS, SPORTS_PERM_LABELS, effectiveSportsPerms } from './perms';

describe('sports permissions', () => {
  it('every permission has a label and the defaults are real permissions', () => {
    for (const p of SPORTS_PERMS) expect(SPORTS_PERM_LABELS[p].length).toBeGreaterThan(3);
    for (const p of DEFAULT_SPORTS_PERMS) expect(SPORTS_PERMS).toContain(p);
    expect(DEFAULT_SPORTS_PERMS).not.toContain('PUBLISH');
    expect(DEFAULT_SPORTS_PERMS).not.toContain('SETTINGS');
  });
  it('an empty or missing column means the defaults; unknown strings are dropped; duplicates collapse', () => {
    expect(effectiveSportsPerms([])).toEqual([...DEFAULT_SPORTS_PERMS]);
    expect(effectiveSportsPerms(null)).toEqual([...DEFAULT_SPORTS_PERMS]);
    expect(effectiveSportsPerms(['ENTER', 'ENTER', 'OLD_THING'])).toEqual(['ENTER']);
    expect(effectiveSportsPerms(['OLD_THING'])).toEqual([...DEFAULT_SPORTS_PERMS]);
  });
});
