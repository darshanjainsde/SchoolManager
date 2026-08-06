import { View } from 'react-native';
import { Skeleton, SkeletonRow } from './Skeleton';
import { Card } from './ui';

/**
 * WHAT "LOADING" LOOKS LIKE EVERYWHERE IN THIS APP.
 *
 * Every screen used to answer a slow network with one grey sentence —
 * "Loading your classes…" — inside an otherwise empty card. Three things were
 * wrong with that. It described the wait instead of the answer. It sized the
 * card to one line, so the page jumped when eight rows landed in a space
 * nothing was holding. And it read as text, which meant a reader had to parse
 * a sentence to learn something a shape says instantly.
 *
 * A skeleton says "a list of pupils is coming, about this many, in about this
 * shape". The layout is already correct before the data exists, so the arrival
 * is a fill rather than a reflow.
 *
 * THE LABEL IS NOT DECORATION. The individual shapes are hidden from
 * accessibility (see Skeleton) precisely because reading a row of empty
 * rectangles aloud is worse than silence — so the wrapper carries the sentence
 * the sighted user no longer needs, as a polite live region. A screen reader
 * hears "Loading your classes" exactly as it did before; everyone else gets
 * the shape.
 */
export function LoadingRows({
  label,
  /** Roughly what is coming. Sizing the hole close to the content is the point. */
  rows = 3,
  /**
   * For a list that loads INSIDE a card that is already on screen — the tests
   * under a class picker, the teachers under "Ask a teacher". Those waits are
   * not the whole screen, and wrapping them in a second card would draw a page
   * inside a page.
   */
  bare = false,
  testID,
}: {
  label: string;
  rows?: number;
  bare?: boolean;
  testID?: string;
}): React.JSX.Element {
  const shapes = (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={bare ? { marginTop: 4 } : undefined}
    >
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} index={i} testID={testID ? `${testID}-row` : undefined} />
      ))}
    </View>
  );
  if (bare) return shapes;
  return (
    <Card testID={testID} style={{ paddingVertical: 6 }}>
      {shapes}
    </Card>
  );
}

/**
 * The register's own wait. A block of squares, because that is what the
 * register IS — see the grid note in app/(staff)/take/[classSectionId].tsx.
 * A list of rows here would promise the wrong screen.
 */
export function LoadingGrid({
  label,
  cells = 24,
  testID,
}: {
  label: string;
  cells?: number;
  testID?: string;
}): React.JSX.Element {
  return (
    <Card testID={testID} style={{ paddingVertical: 12 }}>
      <View
        accessible
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}
      >
        {Array.from({ length: cells }, (_, i) => (
          // Same 46px square and 9px radius as a real cell, so the roster
          // lands into the space its own skeleton was holding.
          <Skeleton
            key={i}
            width={46}
            height={46}
            radius={9}
            index={i % 8}
            testID={testID ? `${testID}-cell` : undefined}
          />
        ))}
      </View>
    </Card>
  );
}
