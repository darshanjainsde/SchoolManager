import { fireEvent, render, screen } from '@testing-library/react-native';
import { DoNow, DO_NOW_MAX } from '../DoNow';

const item = (key: string, onPress = jest.fn()) => ({ key, icon: 'take', title: `Take ${key} register`, line: 'English · 09:30–10:15', verb: 'Take', onPress });

describe('Do now on Home', () => {
  it('is not drawn at all when nothing waits', () => {
    render(<DoNow items={[]} />);
    expect(screen.queryByTestId('donow')).toBeNull();
    expect(screen.queryByText('Do now')).toBeNull();
  });

  it('finishes a job in one tap: the whole row is the button, read as title, line and verb', () => {
    const go = jest.fn();
    render(<DoNow items={[item('V-C', go)]} />);
    fireEvent.press(screen.getByRole('button', { name: 'Take V-C register. English · 09:30–10:15. Take' }));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it(`shows at most ${DO_NOW_MAX} rows, so it never becomes a second menu`, () => {
    render(<DoNow items={['a', 'b', 'c', 'd', 'e', 'f'].map((k) => item(k))} />);
    expect(screen.getByTestId('donow-d')).toBeTruthy();
    expect(screen.queryByTestId('donow-e')).toBeNull();
  });
});
