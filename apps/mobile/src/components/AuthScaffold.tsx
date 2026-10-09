import { type ReactNode } from 'react';
import { Pressable, Text, View, type TextStyle } from 'react-native';
import { Button } from '@/components/Button';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';


// ── The gate's form vocabulary (`.fld`, `.savebtn`, `.linkish`, `.gatesub`,
//    `.resetok`) ────────────────────────────────────────────────────────────
// Shared by all three auth screens so the first thing anyone sees of this app
// is drawn once. They live beside the scaffold rather than in components/ui
// because nothing behind the gate uses them: inside the app a field sits on a
// diary page, here it sits on the card that stands in front of one.
//
// Sizes come from the pitch's own auth block (`.fld input{font-size:14px;
// padding:11px 13px}`, radius 11, a 1.5px rule border) — that block is already
// drawn at something close to device scale, unlike the pitch's rail rows. The
// one number lifted upward is the button label: the pitch's 12.5px is a phone
// MOCK's caption size and would be uncomfortably small as the primary control
// on a real handset.

/**
 * `.fld` — a labelled field.
 *
 * The label is UPPERCASE, tracked and dim above the input rather than a
 * placeholder inside it, because a placeholder disappears the moment someone
 * starts typing and these are the two or three facts a person is most likely to
 * mistype. Tracked small-caps is also the register-book way to head a column,
 * which is the voice this whole app is written in.
 */
export function Field({
  label,
  children,
  hint,
  error,
  optional,
  counter,
}: {
  label: string;
  children: ReactNode;
  /** The line under the box: what to type, or the format. */
  hint?: string;
  /** Replaces the hint in the SAME line, so nothing jumps (Material 3). */
  error?: string | null;
  /** "(optional)" after the label — mark optional, not only required (Baymard). */
  optional?: boolean;
  /** "41 / 200", shown past 75% of the limit by the caller. */
  counter?: string;
}) {
  const tokens = useTokens();
  // UI v2: the label is a sentence above the box at 13/600 — readable, not a
  // tracked small-cap — and the supporting line is always reserved.
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', color: tokens.color.ink2 }}>
        {label}
        {optional ? <Text style={{ fontWeight: '500', color: tokens.color.sub }}> (optional)</Text> : null}
      </Text>
      {children}
      {hint || error || counter ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, minHeight: 16 }}>
          <Text
            accessibilityLiveRegion={error ? 'polite' : 'none'}
            style={{ flex: 1, fontSize: 12, lineHeight: 16, color: error ? tokens.color.red : tokens.color.sub }}
          >
            {error ?? hint ?? ''}
          </Text>
          {counter ? <Text style={{ fontSize: 12, lineHeight: 16, color: tokens.color.sub, fontVariant: ['tabular-nums'] }}>{counter}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The `.fld input` style: paper fill, a 1.5px pencil rule that turns ACCENT on
 * focus (the pitch's only focus signal — no glow, no shadow, the rule is simply
 * inked in), radius 11.
 *
 * `mono` sets the field in the figure face with wide tracking, for a value that
 * is read and typed CHARACTER BY CHARACTER rather than as a word: a student
 * code like RAF-00042 is checked digit against digit off a printed letter, and
 * proportional type makes that check harder than it needs to be.
 */
export function fieldInputStyle(
  tokens: { color: { appBg: string; surface?: string; indigo: string; line: string; line2?: string; ink: string; red?: string } },
  opts: { focused?: boolean; mono?: boolean; error?: boolean; multiline?: boolean } = {},
): TextStyle {
  // UI v2: a white box, 56 dp, 14 dp corners; 1 dp line at rest, 2 dp accent
  // on focus, 2 dp error colour when wrong. Input at 16 sp (Material 3).
  const border = opts.error ? (tokens.color.red ?? tokens.color.indigo) : opts.focused ? tokens.color.indigo : (tokens.color.line2 ?? tokens.color.line);
  return {
    backgroundColor: tokens.color.surface ?? tokens.color.appBg,
    borderColor: border,
    borderWidth: opts.focused || opts.error ? 2 : 1,
    borderRadius: 14,
    minHeight: opts.multiline ? 96 : 56,
    paddingVertical: opts.multiline ? 14 : 0,
    paddingHorizontal: opts.focused || opts.error ? 15 : 16,
    color: tokens.color.ink,
    textAlignVertical: opts.multiline ? 'top' : 'center',
    ...(opts.mono
      ? { fontFamily: font.mono, fontSize: 16, letterSpacing: 1.2 }
      : { fontSize: 16 }),
  };
}

/**
 * `.savebtn` — the one thing this screen is for, full width, in the accent.
 *
 * `.press` is the pitch's tap acknowledgement (`transform:scale(.965)`): the
 * button visibly gives under the finger, which is what stops a second tap while
 * a request is in flight. It is a touch-tracking transform, not an animation
 * that plays on its own, so there is no reduce-motion case to honour — it lasts
 * exactly as long as the finger is down.
 */
export function AuthButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  // UI v2: the one Button, filled and full width (components/Button.tsx).
  return <Button label={label} onPress={onPress} disabled={disabled} testID={testID} block />;
}

/**
 * `.quickfill` / `.linkish` — the pitch's two flavours of bare link: a small
 * bold ACCENT word (the way out of this screen) or the same shape in meta grey
 * (the way back to the last one). Both are text, never a second button: a
 * screen with two filled buttons has no primary action.
 */
export function AuthLink({
  label,
  onPress,
  tone = 'accent',
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'muted';
  testID?: string;
}) {
  const tokens = useTokens();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      hitSlop={10}
      // A 44 dp row: the words are small, the target is not.
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingVertical: 6, transform: [{ scale: pressed ? 0.965 : 1 }] })}
    >
      <Text
        style={{
          color: tone === 'accent' ? tokens.color.indigo : tokens.color.sub,
          fontWeight: '700',
          textAlign: 'center',
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * `.gatesub` — the small grey line that explains a field without shouting. Sits
 * UNDER the input it belongs to, so it reads as a footnote to that field rather
 * than as instructions to the whole screen (the scaffold's own subtitle already
 * does that job, up on the hero).
 */
export function AuthNote({ children }: { children: ReactNode }) {
  const tokens = useTokens();
  return (
    <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub, marginTop: -8 }}>{children}</Text>
  );
}

/**
 * `.resetok` — the outcome slip: a tinted panel OUTLINED in its own ink
 * (`border:1.5px solid`, radius 11) rather than a floating toast, because this
 * one is the whole answer to the question the screen asked and it has to stay
 * on the page while the person goes to check their inbox.
 *
 * Two tones, exactly as the pitch uses them: `good` for "the link is on its
 * way", `warn` (amber) for the honest not-quite-success — the code was fine but
 * there is no email on file, so nothing was sent. That second case must never
 * be dressed in the green of the first.
 */
export function AuthSlip({
  tone,
  children,
  testID,
}: {
  tone: 'good' | 'warn';
  children: ReactNode;
  testID?: string;
}) {
  const tokens = useTokens();
  const fg = tone === 'good' ? tokens.color.green : tokens.color.late;
  const bg = tone === 'good' ? tokens.color.green50 : tokens.color.amber50;
  return (
    <View
      style={{
        borderWidth: 1.5,
        borderColor: tone === 'good' ? tokens.color.green : tokens.color.amber,
        backgroundColor: bg,
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <Text testID={testID} style={{ color: fg, fontSize: 14, lineHeight: 20, fontWeight: '600' }}>
        {children}
      </Text>
    </View>
  );
}
