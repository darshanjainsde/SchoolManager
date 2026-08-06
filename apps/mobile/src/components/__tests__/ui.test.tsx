import { fireEvent, render } from '@testing-library/react-native';
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

/**
 * Regression net for N3 (Holiday.type crash guard): `pillTones[tone]` used
 * to be destructured with no fallback, so an unrecognized tone (e.g. from a
 * `Holiday.type` value that isn't DB-enum-enforced, only `@IsIn`-validated
 * at write time) threw and crashed the whole screen. `tone` is cast here
 * the same way an unvalidated API value would arrive at runtime, bypassing
 * the compile-time `keyof typeof pillTones` guarantee.
 */
it('Pill falls back to the neutral tone instead of throwing for an unrecognized tone', () => {
  const { getByText } = render(
    <Pill tone={'SOME_UNKNOWN_TYPE' as never}>Mystery</Pill>,
  );
  expect(getByText('Mystery')).toBeTruthy();
});

it('SectionTitle shows title', () => {
  const { getByText } = render(<SectionTitle title="Quick actions" />);
  expect(getByText('Quick actions')).toBeTruthy();
});

it('Card renders children', () => {
  const { getByText } = render(<Card><Text>inside</Text></Card>);
  expect(getByText('inside')).toBeTruthy();
});

describe('pull to refresh', () => {
  it('offers no spinner at all on a screen that cannot reload', () => {
    // Better than a spinner that pulls and does nothing — which is what every
    // screen did before this existed.
    const { queryByTestId } = render(
      <Screen>
        <Text>plain</Text>
      </Screen>,
    );
    // RefreshControl is a PROP on the ScrollView, not a node in the tree, so
    // its absence is asserted where it actually lives.
    expect(queryByTestId('screen-scroll')?.props.refreshControl).toBeUndefined();
  });

  it('runs the reload when a screen provides one', () => {
    const onRefresh = jest.fn();
    const { getByTestId } = render(
      <Screen onRefresh={onRefresh}>
        <Text>reloadable</Text>
      </Screen>,
    );
    fireEvent(getByTestId('screen-scroll'), 'refresh');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
