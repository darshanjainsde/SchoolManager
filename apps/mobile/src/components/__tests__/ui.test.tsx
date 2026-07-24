import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card, Pill, Screen, SectionTitle } from '../ui';

it('Screen applies the 11px rhythm gap', () => {
  const { getByTestId } = render(<Screen><Text>x</Text></Screen>);
  const style = getByTestId('screen-scroll').props.contentContainerStyle;
  expect(style.gap).toBe(11);
});

it('Pill renders tone text', () => {
  const { getByText } = render(<Pill tone="green">Present</Pill>);
  expect(getByText('Present')).toBeTruthy();
});

it('SectionTitle shows title', () => {
  const { getByText } = render(<SectionTitle title="Quick actions" />);
  expect(getByText('Quick actions')).toBeTruthy();
});

it('Card renders children', () => {
  const { getByText } = render(<Card><Text>inside</Text></Card>);
  expect(getByText('inside')).toBeTruthy();
});
