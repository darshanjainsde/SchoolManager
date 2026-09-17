import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Sheet } from '../Sheet';

describe('Sheet', () => {
  it('renders its title and children when open, with a backdrop that closes it', () => {
    const onClose = jest.fn();
    const { getByText, getByTestId } = render(
      <Sheet open onClose={onClose} title="Pay by bank transfer" testID="pay-sheet">
        <Text>Account 5010 0441</Text>
      </Sheet>,
    );
    expect(getByText('Pay by bank transfer')).toBeTruthy();
    expect(getByText('Account 5010 0441')).toBeTruthy();
    fireEvent.press(getByTestId('pay-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('honours explicit test ids so the calendar and period sheets keep theirs', () => {
    const { getByTestId } = render(
      <Sheet open onClose={() => {}} testID="calendar-sheet" backdropTestID="calendar-backdrop">
        <Text>x</Text>
      </Sheet>,
    );
    expect(getByTestId('calendar-sheet')).toBeTruthy();
    expect(getByTestId('calendar-backdrop')).toBeTruthy();
  });
});
