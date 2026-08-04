import { Animated } from 'react-native';
import { DASH, pinStyle, play, stampStyle, strokeDashoffset, tokenStyle } from '../motion';

/**
 * THE INVISIBLE-CONTENT GUARD (mobile half — see the web twin at
 * apps/web/app/sk-motion-safety.test.ts).
 *
 * Every entrance gesture starts from `opacity: 0`; that is what makes it an
 * entrance. The consequence is that a container wearing one of these styles is
 * INVISIBLE until its driving `Animated.Value` reaches 1 — and a React Native
 * test renders the tree without ever running the animation, so a screen whose
 * gesture never fires still satisfies every `getByTestId` and `getByText` in
 * the suite while showing a human nothing at all.
 *
 * These assertions pin the two properties that make that impossible:
 *   1. at rest (value 1) every gesture is fully visible and untransformed, and
 *   2. under reduce-motion `play()` jumps straight to the finished value
 *      rather than skipping the animation and leaving the value at 0 — the
 *      classic reduced-motion regression, which fails exactly the users least
 *      able to work around it.
 */

/** Reads an interpolated style value at a given driver position. */
function at(value: Animated.Value, position: number, read: () => unknown): unknown {
  value.setValue(position);
  return read();
}

/** Animated interpolations expose their current output via a private hook. */
function current(node: unknown): number | string {
  return (node as { __getValue: () => number | string }).__getValue();
}

describe('motion — an entrance gesture can never strand content invisible', () => {
  it('THE PIN is transparent at the start and fully opaque, square, at rest', () => {
    const v = new Animated.Value(0);
    const style = pinStyle(v);

    expect(at(v, 0, () => current(style.opacity))).toBe(0);
    expect(at(v, 1, () => current(style.opacity))).toBe(1);
    // At rest it must also be back on the baseline and straight — a pin that
    // settles 2px low or a degree off would knock every row out of alignment.
    expect(current(style.transform[0].translateY)).toBe(0);
    expect(current(style.transform[1].rotate)).toBe('0deg');
  });

  it('THE STAMP is transparent at the start and fully opaque at rest', () => {
    const v = new Animated.Value(0);
    const style = stampStyle(v);

    expect(at(v, 0, () => current(style.opacity))).toBe(0);
    expect(at(v, 1, () => current(style.opacity))).toBe(1);
    // A stamp DOES rest off-square — that is the gesture — but at its own size.
    expect(current(style.transform[0].scale)).toBe(1);
    expect(current(style.transform[1].rotate)).toBe('-2deg');
  });

  it('THE TOKEN POP ends at full size and opacity', () => {
    const v = new Animated.Value(1);
    const style = tokenStyle(v);
    expect(current(style.opacity)).toBe(1);
    expect(current(style.transform[0].scale)).toBe(1);
  });

  it('the stroke gestures finish at a zero dash offset — an unwritten tick is not "subtle", it is absent', () => {
    const v = new Animated.Value(1);
    expect(current(strokeDashoffset(v, DASH.tick))).toBe(0);
    expect(current(strokeDashoffset(v, DASH.signature))).toBe(0);
  });

  it('reduce-motion JUMPS to the finished value instead of skipping the animation', () => {
    const v = new Animated.Value(0);
    // The whole point: a reduced-motion user must end up at 1 (visible),
    // synchronously, without an animation ever running.
    const anim = play(v, 400, { reduced: true });

    expect(anim).toBeNull(); // nothing was scheduled…
    expect(current(v)).toBe(1); // …and yet the content is on screen.
  });

  it('reduce-motion honours an explicit target, not just 1', () => {
    const v = new Animated.Value(0);
    play(v, 400, { reduced: true, toValue: 0.42 });
    expect(current(v)).toBe(0.42);
  });

  it('without reduce-motion it schedules a real animation rather than snapping', () => {
    const v = new Animated.Value(0);
    const anim = play(v, 400, { reduced: false });
    expect(anim).not.toBeNull();
    anim?.stop();
  });
});
