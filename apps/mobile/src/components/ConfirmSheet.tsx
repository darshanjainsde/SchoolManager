import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { Icon, type IconName } from './icons';
import { useTokens } from '@/theme/theme-context';

/**
 * THE CONFIRM SHEET — every "are you sure?" in the app, in the app's own voice.
 *
 * The user (9 Oct 2026): "signout popup is very simple for all roles". It was
 * the stock Android dialog — teal capital-letter text buttons on a white box,
 * the one screen in the app that ignored the accent, the radius scale and the
 * 48 dp touch floor. This is the same question as a bottom sheet:
 *   a 64 dp tinted circle with the glyph (red for something that removes),
 *   the question 20/700, the consequence 15/22 in `sub`,
 *   an optional "who" row (the account being signed out),
 *   full-width 52 dp buttons, the action first and "Stay"/"Cancel" under it —
 *   both in the thumb zone, the action never a bare word in a corner.
 *
 * `ask()` keeps Alert.alert's signature (title, message, buttons, options) so
 * every call site swaps one word. With no <ConfirmHost/> mounted (unit tests,
 * a crash screen) it falls back to Alert.alert, so a confirm can never vanish.
 */
export interface AskButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}
export interface AskOptions {
  icon?: IconName;
  onDismiss?: () => void;
  /** A person row under the message — who this applies to. */
  who?: { initials: string; name: string; line?: string };
  testID?: string;
}
interface Request {
  title: string;
  message?: string;
  buttons: AskButton[];
  opts: AskOptions;
}

let show: ((r: Request) => void) | null = null;

export function ask(title: string, message?: string, buttons?: AskButton[], opts: AskOptions = {}): void {
  const list = buttons && buttons.length ? buttons : [{ text: 'OK' }];
  if (!show) {
    if (opts.onDismiss) Alert.alert(title, message, list, { onDismiss: opts.onDismiss });
    else Alert.alert(title, message, list);
    return;
  }
  show({ title, message, buttons: list, opts });
}

/** Mount once, at the root, inside the ThemeProvider. */
export function ConfirmHost(): ReactNode {
  const [req, setReq] = useState<Request | null>(null);
  useEffect(() => {
    show = setReq;
    return () => {
      if (show === setReq) show = null;
    };
  }, []);
  if (!req) return null;
  return <ConfirmSheet request={req} onDone={() => setReq(null)} />;
}

function ConfirmSheet({ request, onDone }: { request: Request; onDone: () => void }) {
  const tokens = useTokens();
  const c = tokens.color;
  const { title, message, buttons, opts } = request;
  const danger = buttons.some((b) => b.style === 'destructive');
  const cancel = buttons.find((b) => b.style === 'cancel');
  const actions = buttons.filter((b) => b.style !== 'cancel');
  const icon: IconName = opts.icon ?? (danger ? 'alert' : 'check');
  const ink = danger ? c.red : c.indigo;
  const soft = danger ? c.red50 : c.indigo50;
  const id = opts.testID ?? 'confirm';

  const finish = (b?: AskButton) => {
    onDone();
    if (b) b.onPress?.();
    else {
      cancel?.onPress?.();
      opts.onDismiss?.();
    }
  };

  return (
    <Sheet open onClose={() => finish()} testID={id} backdropTestID={`${id}-backdrop`} backdropLabel={cancel?.text ?? 'Close'}>
      <View style={{ alignItems: 'center', paddingTop: 8, paddingHorizontal: 8 }}>
        <View
          testID={`${id}-icon`}
          style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={icon} size={30} color={ink} fillOpacity={0.2} />
        </View>
        <Text
          testID={`${id}-title`}
          accessibilityRole="header"
          style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: c.ink, textAlign: 'center', marginTop: 16 }}
        >
          {title}
        </Text>
        {message ? (
          <Text style={{ fontSize: 15, lineHeight: 22, color: c.sub, textAlign: 'center', marginTop: 8 }}>{message}</Text>
        ) : null}
        {opts.who ? (
          <View
            testID={`${id}-who`}
            style={{
              alignSelf: 'stretch',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              marginTop: 16,
              padding: 12,
              borderRadius: 16,
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.line,
            }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.indigo, fontWeight: '700', fontSize: 15 }}>{opts.who.initials}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, lineHeight: 22, fontWeight: '600', color: c.ink }}>{opts.who.name}</Text>
              {opts.who.line ? <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: c.sub }}>{opts.who.line}</Text> : null}
            </View>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 8, marginTop: 24, marginBottom: 4 }}>
        {actions.map((b, i) => {
          const destructive = b.style === 'destructive';
          const filled = i === 0;
          const bg = filled ? (destructive ? c.red : c.indigo) : 'transparent';
          const fg = filled ? c.onBrand : destructive ? c.red : c.indigo;
          return (
            <SheetButton
              key={b.text}
              testID={`${id}-action-${i}`}
              label={b.text}
              bg={bg}
              fg={fg}
              border={filled ? bg : c.line2}
              onPress={() => finish(b)}
            />
          );
        })}
        {cancel ? (
          <SheetButton testID={`${id}-cancel`} label={cancel.text} bg={c.surfaceMuted} fg={c.ink} border={c.surfaceMuted} onPress={() => finish()} />
        ) : null}
      </View>
    </Sheet>
  );
}

function SheetButton({ label, bg, fg, border, onPress, testID }: { label: string; bg: string; fg: string; border: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        borderRadius: 26,
        backgroundColor: bg,
        borderWidth: 1.5,
        borderColor: border,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: fg, fontSize: 16, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
