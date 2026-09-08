import { displayNameOf, landingYearOf, photoAssetIdsOf, photoAssetOf, projectHallOfFame, yearsOf, type HallOfFameRead } from './hall-of-fame.read';

const G1 = 'g1';
const G2 = 'g2';
const entry = (groupId: string, batchYear: number, rank: number, name = `${groupId}-${batchYear}-${rank}`) => ({
  id: `${groupId}-${batchYear}-${rank}`,
  groupId,
  batchYear,
  rank,
  name,
  achievement: null,
  photoAssetId: rank === 1 ? 'asset-1' : null,
  studentId: null,
  student: null,
});
const read = (over: Partial<HallOfFameRead> = {}): HallOfFameRead => ({
  groups: [
    { id: G1, kind: 'COURSE', label: 'Primary', order: 0, courseId: 'c1', gradeIds: [], sectionIds: [] },
    { id: G2, kind: 'CUSTOM', label: 'Board toppers', order: 1, courseId: null, gradeIds: [], sectionIds: [] },
  ],
  entries: [entry(G1, 2025, 1), entry(G1, 2025, 2), entry(G1, 2024, 1), entry(G1, 2022, 1), entry(G2, 2023, 1)],
  settings: { landingYear: null, pastBatches: 4 },
  ...over,
});
const urlOf = (id: string | null | undefined) => (id ? `https://cdn/${id}` : null);

describe('hall of fame projection', () => {
  it('lists years newest first and lands on the newest by default', () => {
    expect(yearsOf(read().entries)).toEqual([2025, 2024, 2023, 2022]);
    expect(landingYearOf([2025, 2024], null)).toBe(2025);
  });

  it('lands on the pinned year only when that batch has entries', () => {
    expect(landingYearOf([2025, 2024], 2024)).toBe(2024);
    expect(landingYearOf([2025, 2024], 2019)).toBe(2025);
  });

  it('shows the pastBatches newest years and only groups with a podium inside them', () => {
    const p = projectHallOfFame(read({ settings: { landingYear: null, pastBatches: 2 } }), urlOf);
    expect(p?.landingYear).toBe(2025);
    expect(p?.years).toEqual([2025, 2024]);
    // Board toppers only has 2023, outside the window — it must not appear.
    expect(p?.groups.map((g) => g.label)).toEqual(['Primary']);
    expect(p?.groups[0].entries.map((e) => e.batchYear)).toEqual([2025, 2025, 2024]);
  });

  it('keeps a pinned older batch inside the window even when it is not among the newest', () => {
    const p = projectHallOfFame(read({ settings: { landingYear: 2022, pastBatches: 2 } }), urlOf);
    expect(p?.landingYear).toBe(2022);
    expect(p?.years).toEqual([2025, 2022]);
  });

  it('resolves photos through the asset map and answers null when there is nothing', () => {
    const p = projectHallOfFame(read(), urlOf);
    expect(p?.groups[0].entries[0].photoUrl).toBe('https://cdn/asset-1');
    expect(p?.groups[0].entries[1].photoUrl).toBeNull();
    expect(projectHallOfFame(null, urlOf)).toBeNull();
    expect(projectHallOfFame(read({ entries: [] }), urlOf)).toBeNull();
  });
});

describe('a linked student is read live', () => {
  const linked = { ...entry(G1, 2025, 1, 'Typed Name'), photoAssetId: null, studentId: 'st-1', student: { firstName: 'Ved', lastName: 'Sharma', photoAssetId: 'avatar-9' } };

  it('prints the register name and shows the profile photo the student set', () => {
    expect(displayNameOf(linked)).toBe('Ved Sharma');
    expect(photoAssetOf(linked)).toBe('avatar-9');
    const p = projectHallOfFame(read({ entries: [linked] }), urlOf);
    expect(p?.groups[0].entries[0]).toMatchObject({ name: 'Ved Sharma', photoUrl: 'https://cdn/avatar-9' });
  });

  it('an explicit upload on the entry still wins over the profile photo', () => {
    expect(photoAssetOf({ ...linked, photoAssetId: 'upload-1' })).toBe('upload-1');
  });

  it('falls back to the typed name and no photo once the student row is gone', () => {
    const gone = { ...linked, student: null };
    expect(displayNameOf(gone)).toBe('Typed Name');
    expect(photoAssetOf(gone)).toBeNull();
  });

  it('collects every asset id the projection may need', () => {
    expect(photoAssetIdsOf(read({ entries: [linked, entry(G1, 2024, 1)] }))).toEqual(['avatar-9', 'asset-1']);
    expect(photoAssetIdsOf(null)).toEqual([]);
  });
});
