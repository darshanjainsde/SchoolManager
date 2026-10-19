import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { BandRings } from '../BandRings';
import { bandRings } from '@/theme/families';
import { palette } from '@/theme/tokens';

describe('the rings on the band', () => {
  it('draws at most three, each with its figure and label, read out as one phrase', () => {
    render(
      <BandRings
        metrics={[
          { value: '3/4', pct: 75, label: 'registers taken', testID: 'r1' },
          { value: '92%', pct: 92, label: 'present today', testID: 'r2' },
          { value: '33%', pct: 33, label: 'syllabus covered', testID: 'r3' },
          { value: '9', pct: 9, label: 'a fourth one', testID: 'r4' },
        ]}
      />,
    );
    expect(screen.getByText('3/4')).toBeTruthy();
    expect(screen.getByLabelText('present today: 92%')).toBeTruthy();
    expect(screen.queryByTestId('r4')).toBeNull();
  });

  it('a ring with somewhere to go is a button that goes there', () => {
    const go = jest.fn();
    render(<BandRings metrics={[{ value: '86%', pct: 86, label: 'present this month', onPress: go, testID: 'r' }]} />);
    fireEvent.press(screen.getByTestId('r'));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'present this month: 86%' })).toBeTruthy();
  });

  it('survives figures outside 0–100 and NaN without drawing nonsense', () => {
    render(<BandRings metrics={[{ value: 'x', pct: Number.NaN, label: 'a' }, { value: 'y', pct: 250, label: 'b' }, { value: 'z', pct: -5, label: 'c' }]} />);
    expect(screen.getByText('x')).toBeTruthy();
    expect(screen.getByText('y')).toBeTruthy();
  });

  it('writes each figure beside the rings in its own ring colour, so no key is needed', () => {
    render(
      <BandRings
        metrics={[
          { value: '3/4', pct: 75, label: 'registers taken' },
          { value: '92%', pct: 92, label: 'present today' },
          { value: '33%', pct: 33, label: 'syllabus covered' },
        ]}
      />,
    );
    const ring = bandRings(palette.light, 'light');
    expect(StyleSheet.flatten(screen.getByText('3/4').props.style).color).toBe(ring[0]);
    expect(StyleSheet.flatten(screen.getByText('33%').props.style).color).toBe(ring[2]);
  });
});
