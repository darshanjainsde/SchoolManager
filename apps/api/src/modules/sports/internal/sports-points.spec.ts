import { diffAwards, ordinal, placingAwards, winAward } from './sports-points';

const houseOf = (side: string) => ({ 's:a': 'red', 's:b': 'blue', 's:c': 'red' } as Record<string, string | null>)[side] ?? null;
const T = [10, 7, 5, 3, 2, 1];

describe('sports points ledger', () => {
  it('placing awards skip sides without a house and ranks off the table', () => {
    expect(placingAwards([{ side: 's:a', rank: 1 }, { side: 's:b', rank: 2 }, { side: 'c:9-A', rank: 3 }, { side: 's:c', rank: 9 }, { side: 's:c', rank: null }], houseOf, T, '100 m Senior Boys')).toEqual([
      { houseId: 'red', points: 10, reason: '100 m Senior Boys: 1st' }, { houseId: 'blue', points: 7, reason: '100 m Senior Boys: 2nd' },
    ]);
    expect(winAward('s:a', houseOf, 5, 'Badminton Final: win')).toEqual([{ houseId: 'red', points: 5, reason: 'Badminton Final: win' }]);
    expect(winAward('c:9-A', houseOf, 5, 'x')).toEqual([]);
    expect(winAward(null, houseOf, 5, 'x')).toEqual([]);
    expect(winAward('s:a', houseOf, 0, 'x')).toEqual([]);
  });
  it('diff writes only the change: a new winner gets the points, the old one a correction; the same result writes nothing', () => {
    const before = [{ houseId: 'red', points: 5, reason: 'Final: win' }];
    const after = [{ houseId: 'blue', points: 5, reason: 'Final: win' }];
    expect(diffAwards(before, after)).toEqual([{ houseId: 'red', points: -5, reason: 'Final: win (correction)' }, { houseId: 'blue', points: 5, reason: 'Final: win' }]);
    expect(diffAwards(before, before)).toEqual([]);
    expect(diffAwards([], after)).toEqual(after);
    expect(diffAwards([{ houseId: 'red', points: 10, reason: 'r: 1st' }, { houseId: 'red', points: 5, reason: 'r: 3rd' }], [{ houseId: 'red', points: 10, reason: 'r: 1st' }])).toEqual([{ houseId: 'red', points: -5, reason: 'r: 3rd (correction)' }]);
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
});
