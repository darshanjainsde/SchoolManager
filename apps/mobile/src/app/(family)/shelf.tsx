import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { family, type ChildProfile } from '@/lib/family-store';
import { session } from '@/lib/session';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { DUR, EASE, useReduceMotion } from '@/theme/motion';
import { font } from '@/theme/tokens';
import { useTokens } from '@/theme/theme-context';

/** The pitch's shelf geometry: four spines to a shelf, a 7px board under each. */
const PER_SHELF = 4;
const SPINE_H = 96;
const ADD_H = 80;
const BAND_H = 9;
const BOARD_H = 7;
/** Past this many children the shelf stops being scannable and needs a filter. */
const SEARCH_AFTER = 8;

/** The pitch's `.spine` corners: rounded at the head, barely rounded at the
 *  foot — a book standing on a shelf, not a rounded rectangle. */
const SPINE_RADII = {
  borderTopLeftRadius: 7,
  borderTopRightRadius: 7,
  borderBottomLeftRadius: 3,
  borderBottomRightRadius: 3,
} as const;

/**
 * One spine on the shelf.
 *
 * WHY A BOOK AND NOT A TILE: this app is a paper diary, and a family with
 * three children owns three diaries — objects that stand next to each other
 * and are picked up one at a time. A grid of avatar tiles says "accounts";
 * a row of spines on a board says "your children's books", which is exactly
 * the relationship: you open one, you are inside it, and nothing of the
 * others comes with you.
 *
 * The name is set the way a real spine is set — running down the book, in the
 * serif the rest of the diary is written in. That is what `writing-mode:
 * vertical-rl` does in the pitch: it rotates the whole run 90° clockwise
 * rather than stacking upright letters, so it is a rotation here too. The
 * rotated `Text` is absolutely positioned so its unrotated (wide, short)
 * layout box cannot push the spine's width around.
 *
 * WHY IT LIFTS ON PRESS: 6px up is the book being drawn a little way out of
 * the shelf before you take it — the acknowledgement that this tap landed on
 * THIS spine, which matters most when four of them sit 9px apart. Under
 * reduce-motion the lift simply does not happen; the navigation that follows
 * is the feedback.
 */
function Spine({ child, active, onPress }: { child: ChildProfile; active: boolean; onPress: () => void }) {
  const tokens = useTokens();
  const reduced = useReduceMotion();
  const lift = useRef(new Animated.Value(0)).current;

  const move = (to: number) => {
    if (reduced.current) return;
    Animated.timing(lift, { toValue: to, duration: DUR.press, easing: EASE, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={{ flex: 1, transform: [{ translateY: lift }] }}>
      <Pressable
        testID={`spine-${child.key}`}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Open ${child.displayName}'s diary`}
        onPressIn={() => move(-6)}
        onPressOut={() => move(0)}
        onPress={onPress}
        style={{
          height: SPINE_H,
          ...SPINE_RADII,
          borderWidth: active ? 1.5 : 1,
          borderColor: active ? child.accent : tokens.color.line,
          backgroundColor: tokens.color.surface,
          // The pitch's `--shadow` is two shadows (a hairline contact shadow
          // and a wide soft one). RN gets one, so this is the soft one, tinted
          // with the ink colour rather than black — paper shadows are never
          // neutral grey.
          shadowColor: tokens.color.ink,
          shadowOpacity: 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
          elevation: 2,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: BAND_H,
            borderTopLeftRadius: 6,
            borderTopRightRadius: 6,
            backgroundColor: child.accent,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: BAND_H,
            left: 0,
            right: 0,
            bottom: 8,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              position: 'absolute',
              width: SPINE_H - BAND_H - 16,
              textAlign: 'center',
              fontFamily: font.serif,
              fontSize: 11.5,
              fontWeight: '600',
              letterSpacing: 0.7,
              textTransform: 'uppercase',
              color: tokens.color.ink,
              transform: [{ rotate: '90deg' }],
            }}
          >
            {child.displayName.split(' ')[0]}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The family shelf (Phase 5·2) — one diary per child, tap to switch, ＋ to add
 * another (any school). Switching swaps the ACTIVE session (tokens + host);
 * every screen already reads through it, so the whole app becomes that
 * child's — with nothing shared between them.
 */
export default function Shelf() {
  const tokens = useTokens();
  const [children, setChildren] = useState<ChildProfile[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([family.list(), family.activeKey()]).then(([list, key]) => {
        if (!cancelled) {
          setChildren(list);
          setActiveKey(key);
        }
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  async function open(child: ChildProfile) {
    if (busy) return;
    setBusy(true);
    await family.setActive(child.key);
    router.replace('/(family)/home');
  }

  async function addChild() {
    // The connect → login flow signs the new child in; login() registers any
    // STUDENT session onto the shelf, so "add" is just the normal front door.
    await session.setSchoolHost(''); // force the school picker for the new child's school
    router.push('/(auth)/connect');
  }

  const shown = useMemo(() => {
    const list = children ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.schoolHost.toLowerCase().includes(q),
    );
  }, [children, query]);

  // Children first, then the ＋ — so "add another" is always the last object on
  // the last shelf, where a new book would physically go.
  const tiles: (ChildProfile | null)[] = [...shown, null];
  const shelves: (ChildProfile | null)[][] = [];
  for (let i = 0; i < tiles.length; i += PER_SHELF) shelves.push(tiles.slice(i, i + PER_SHELF));

  return (
    <Screen>
      <SectionTitle title="Your shelf" />
      <Text style={{ marginHorizontal: 4, fontSize: 12, color: tokens.color.sub }}>
        One diary per child — tap to open theirs. Different schools are fine; each spine wears its school's colour.
      </Text>

      {children !== null && children.length > SEARCH_AFTER && (
        <TextInput
          testID="shelf-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Find a child"
          placeholderTextColor={tokens.color.placeholder}
          accessibilityLabel="Find a child on the shelf"
          style={{
            borderWidth: 1,
            borderColor: tokens.color.line,
            backgroundColor: tokens.color.surface,
            borderRadius: 11,
            paddingHorizontal: 12,
            paddingVertical: 9,
            fontSize: 13,
            color: tokens.color.ink,
          }}
        />
      )}

      {children === null ? (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading…</Text>
        </Card>
      ) : (
        <View>
          {shelves.map((shelf, si) => (
            <View key={si}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 9,
                  paddingHorizontal: 6,
                  paddingTop: 14,
                }}
              >
                {shelf.map((child) =>
                  child ? (
                    <Spine
                      key={child.key}
                      child={child}
                      active={child.key === activeKey}
                      onPress={() => void open(child)}
                    />
                  ) : (
                    <Pressable
                      key="add"
                      testID="shelf-add"
                      accessibilityRole="button"
                      accessibilityLabel="Add a child"
                      onPress={() => void addChild()}
                      style={{
                        flex: 1,
                        height: ADD_H,
                        ...SPINE_RADII,
                        borderWidth: 1.5,
                        borderStyle: 'dashed',
                        borderColor: tokens.color.line,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 19, color: tokens.color.sub }}>＋</Text>
                    </Pressable>
                  ),
                )}
                {/* Keeps the last shelf's spines the same width as a full one —
                    a grid column that happens to be empty, not a wider book. */}
                {Array.from({ length: PER_SHELF - shelf.length }, (_, i) => (
                  <View key={`gap-${i}`} style={{ flex: 1 }} />
                ))}
              </View>
              <View
                style={{
                  height: BOARD_H,
                  borderRadius: 4,
                  marginHorizontal: 6,
                  backgroundColor: tokens.color.line2,
                }}
              />
            </View>
          ))}
        </View>
      )}

      <Text style={{ marginHorizontal: 4, fontSize: 10, color: tokens.color.sub, textAlign: 'center', marginTop: 6 }}>
        Four spines per shelf, new shelves underneath.{'\n'}＋ adds a child by their code (RAF-00042) and password —
        even at another school.{'\n'}Each child keeps their own notifications, badges and data.
      </Text>
    </Screen>
  );
}
