import { render, fireEvent } from '@testing-library/react-native';
import More from '../more';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

beforeEach(() => {
  mockPush.mockReset();
});

it('navigates to the holidays screen', async () => {
  const { findByText } = render(<More />);

  fireEvent.press(await findByText('Holidays'));

  expect(mockPush).toHaveBeenCalledWith('/(family)/holidays');
});
