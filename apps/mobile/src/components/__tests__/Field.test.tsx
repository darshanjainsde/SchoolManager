import { fireEvent, render } from '@testing-library/react-native';
import { MoneyField, SegmentedField, TextField } from '../Field';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

describe('MoneyField', () => {
  it('hands the caller PAISE for what was typed, never a float rupee', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<MoneyField label="Amount" valueMinor={0} onChangeMinor={onChange} testID="amt" />);
    fireEvent.changeText(getByTestId('amt'), '24,500.50');
    expect(onChange).toHaveBeenLastCalledWith(2450050);
  });
  it('opens showing the figure it was given', () => {
    const { getByTestId } = render(<MoneyField label="Amount" valueMinor={2450000} onChangeMinor={() => {}} testID="amt" />);
    expect(getByTestId('amt').props.value).toBe('24500');
  });
});

describe('SegmentedField', () => {
  const opts = [
    { value: 'UPI', label: 'UPI' },
    { value: 'CASH', label: 'Cash' },
  ] as const;
  it('marks the chosen option and reports a tap', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<SegmentedField label="How" options={opts} value="UPI" onChange={onChange} testID="how" />);
    expect(getByTestId('how-UPI').props.accessibilityState.checked).toBe(true);
    fireEvent.press(getByTestId('how-CASH'));
    expect(onChange).toHaveBeenCalledWith('CASH');
  });
});

describe('TextField', () => {
  it('renders its label and passes text through', () => {
    const onChangeText = jest.fn();
    const { getByText, getByTestId } = render(<TextField label="UTR" value="" onChangeText={onChangeText} testID="utr" />);
    expect(getByText('UTR')).toBeTruthy();
    fireEvent.changeText(getByTestId('utr'), '4418');
    expect(onChangeText).toHaveBeenCalledWith('4418');
  });
});
