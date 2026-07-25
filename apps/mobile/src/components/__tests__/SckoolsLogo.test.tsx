import { render } from '@testing-library/react-native';
import { SckoolsLogo } from '../SckoolsLogo';

describe('SckoolsLogo', () => {
  it('renders the wordmark by default', () => {
    const { getByText } = render(<SckoolsLogo size={32} />);
    expect(getByText('Sckools')).toBeTruthy();
  });

  it('omits the wordmark for the symbol variant', () => {
    const { queryByText } = render(<SckoolsLogo size={32} variant="symbol" />);
    expect(queryByText('Sckools')).toBeNull();
  });
});
