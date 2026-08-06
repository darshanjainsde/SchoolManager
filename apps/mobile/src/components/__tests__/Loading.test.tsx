import { render, screen } from '@testing-library/react-native';
import { LoadingGrid, LoadingRows } from '../Loading';
import { ThemeProvider } from '@/theme/theme-context';

function mount(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

const hidden = { includeHiddenElements: true } as const;

describe('LoadingRows', () => {
  it('holds a hole the size of the answer', () => {
    // The row count is load-bearing, not decoration: sizing the placeholder
    // close to the content is the whole reason the arrival is a fill rather
    // than a reflow. A component that ignored `rows` would still look fine in
    // a screenshot and still jump the page on every load.
    mount(<LoadingRows label="Loading your classes…" rows={6} testID="wait" />);
    expect(screen.getAllByTestId('wait-row', hidden)).toHaveLength(6);

    screen.unmount();
    mount(<LoadingRows label="Loading your classes…" rows={2} testID="wait" />);
    expect(screen.getAllByTestId('wait-row', hidden)).toHaveLength(2);
  });

  it('says the sentence to a screen reader that can no longer see the shape', () => {
    // The bars themselves are a11y-hidden (a row of empty rectangles read
    // aloud is worse than silence), so if this label ever went away, a blind
    // user would get NOTHING at all while the screen loaded — strictly worse
    // than the plain "Loading…" text this replaced.
    mount(<LoadingRows label="Loading your requests…" rows={4} />);
    expect(screen.getByLabelText('Loading your requests…')).toBeTruthy();
  });

  it('announces once, not once per bar', () => {
    mount(<LoadingRows label="Loading messages…" rows={5} />);
    expect(screen.getAllByLabelText('Loading messages…')).toHaveLength(1);
  });
});

describe('LoadingGrid', () => {
  it('promises a block of cells, not a list of rows', () => {
    // The register is a grid of forty squares (see the grid note in
    // app/(staff)/take/[classSectionId].tsx). A skeleton of stacked rows would
    // be promising a shape that screen never takes.
    mount(<LoadingGrid label="Loading roster…" cells={30} testID="grid-wait" />);
    expect(screen.getAllByTestId('grid-wait-cell', hidden)).toHaveLength(30);
    expect(screen.getByLabelText('Loading roster…')).toBeTruthy();
  });
});
