import { fireEvent, render } from '@testing-library/react-native';
import { ClassChips } from '../ClassChips';

const classes = [
  { classSectionId: 'a', name: 'Grade 5-B' },
  { classSectionId: 'b', name: 'Grade 6-A' },
];

it('toggles selection on tap', () => {
  const onChange = jest.fn();
  const { getByText } = render(<ClassChips classes={classes} selected={['a']} onChange={onChange} />);
  fireEvent.press(getByText('Grade 6-A'));
  expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  fireEvent.press(getByText(/Grade 5-B/));
  expect(onChange).toHaveBeenCalledWith([]);
});

it('each chip toggles independently and shows a check mark when selected', () => {
  const onChange = jest.fn();
  const { getByText, queryByText, rerender } = render(
    <ClassChips classes={classes} selected={[]} onChange={onChange} />,
  );
  expect(queryByText(/✓/)).toBeNull();

  fireEvent.press(getByText('Grade 5-B'));
  expect(onChange).toHaveBeenLastCalledWith(['a']);

  rerender(<ClassChips classes={classes} selected={['a']} onChange={onChange} />);
  expect(getByText(/✓ Grade 5-B/)).toBeTruthy();
  expect(queryByText(/✓ Grade 6-A/)).toBeNull();

  fireEvent.press(getByText('Grade 6-A'));
  expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
});
