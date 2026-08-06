import { useState } from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StudentPicker, type PickableStudent } from '../StudentPicker';

const CLASS: PickableStudent[] = [
  { id: 'stu-anjali', name: 'Anjali Rao', rollNo: '1' },
  { id: 'stu-anjana', name: 'Anjana Iyer', rollNo: '2' },
  { id: 'stu-ankur', name: 'Ankur Shah', rollNo: '3' },
  { id: 'stu-diya', name: 'Diya Patel', rollNo: '4' },
];

/** Stateful host, as every real caller is — selection must round-trip. */
function Host() {
  const [selected, setSelected] = useState<string[]>([]);
  return <StudentPicker students={CLASS} selected={selected} onChange={setSelected} />;
}

it('picks several children from ONE open drawer — the query survives every tap', () => {
  const { getByTestId, queryByTestId } = render(<Host />);

  fireEvent.changeText(getByTestId('student-picker-input'), 'an');
  // Three taps, no retyping in between: the drawer must stay open on "an".
  fireEvent.press(getByTestId('match-stu-anjali'));
  fireEvent.press(getByTestId('match-stu-anjana'));
  fireEvent.press(getByTestId('match-stu-ankur'));

  expect(getByTestId('token-stu-anjali')).toBeTruthy();
  expect(getByTestId('token-stu-anjana')).toBeTruthy();
  expect(getByTestId('token-stu-ankur')).toBeTruthy();
  // The rows stay in the drawer, ticked — not filtered away.
  expect(getByTestId('match-picked-stu-anjali')).toBeTruthy();
  expect(getByTestId('match-picked-stu-ankur')).toBeTruthy();
  // The input still holds the query (the drawer would close without it).
  expect(getByTestId('student-picker-input').props.value).toBe('an');
  expect(queryByTestId('match-stu-diya')).toBeNull(); // still filtered by "an"
});

it('a picked row is a toggle — tapping it again removes the token', () => {
  const { getByTestId, queryByTestId } = render(<Host />);

  fireEvent.changeText(getByTestId('student-picker-input'), 'anjali');
  fireEvent.press(getByTestId('match-stu-anjali'));
  expect(getByTestId('token-stu-anjali')).toBeTruthy();

  fireEvent.press(getByTestId('match-stu-anjali'));
  expect(queryByTestId('token-stu-anjali')).toBeNull();
  expect(queryByTestId('match-picked-stu-anjali')).toBeNull();
});
