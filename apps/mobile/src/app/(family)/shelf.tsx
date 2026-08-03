import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { family, type ChildProfile } from '@/lib/family-store';
import { session } from '@/lib/session';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { DUR, EASE, useReduceMotion } from '@/theme/motion';
import { useTokens } from '@/theme/theme-context';

/** Past this many children the shelf stops being scannable and needs a filter. */
const SEARCH_AFTER = 8;

/** "AS" for Aarav Sharma. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * One spine on the shelf — school-coloured band, the child's initials, the
 * child's own first name and their school, and an OPEN marker on the active
 * one.
 *
 * UPRIGHT, deliberately. The repaint set the name the way a real book spine is
 * set — rotated 90°, uppercase, clipped to one line inside a 71dp box — and
 * dropped the initials disc, the school name and the OPEN marker with it. On a
 * shelf whose whole job is "which of my children is this, and which one am I
 * currently in", that removed both answers: a sideways truncated forename is
 * slower to read than a horizontal one, and the school is the thing that tells
 * two children at different schools apart.
 *
 * WHY IT LIFTS ON PRESS: 6px up is the book being drawn a little way out of
 * the shelf before you take it — the acknowledgement that this tap landed on
 * THIS spine. Under reduce-motion the lift simply does not happen; the
 * navigation that follows is the feedback.
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
    <Animated.View style={{ width: '23%', transform: [{ translateY: lift }] }}>
      <Pressable
        testID={`spine-${child.key}`}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Open ${child.displayName}'s diary`}
        onPressIn={() => move(-6)}
        onPressOut={() => move(0)}
        onPress={onPress}
        style={{
          borderRadius: 12,
          borderWidth: active ? 2 : 1,
          borderColor: active ? child.accent : tokens.color.line,
          backgroundColor: tokens.color.surface,
          overflow: 'hidden',
          alignItems: 'center',
          paddingBottom: 10,
        }}
      >
        <View style={{ alignSelf: 'stretch', height: 8, backgroundColor: child.accent }} />
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            marginTop: 10,
            marginBottom: 6,
            backgroundColor: child.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: tokens.color.onBrand, fontWeight: '800', fontSize: 14 }}>
            {initials(child.displayName)}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: tokens.color.ink, maxWidth: '90%' }}>
          {child.displayName.split(' ')[0]}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 8.5, color: tokens.color.sub, maxWidth: '92%' }}>
          {child.schoolHost.split('.')[0]}
        </Text>
        {active && (
          <Text style={{ fontSize: 8.5, fontWeight: '800', color: child.accent, marginTop: 2 }}>OPEN</Text>
        )}
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
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-start' }}>
          {shown.map((c) => (
            <Spine key={c.key} child={c} active={c.key === activeKey} onPress={() => void open(c)} />
          ))}
          <Pressable
            testID="shelf-add"
            accessibilityRole="button"
            accessibilityLabel="Add a child"
            onPress={() => void addChild()}
            style={{
              width: '23%',
              minHeight: 108,
              borderRadius: 12,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: tokens.color.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 22, color: tokens.color.sub }}>＋</Text>
            <Text style={{ fontSize: 9, fontWeight: '700', color: tokens.color.sub, marginTop: 2 }}>Add a child</Text>
          </Pressable>
        </View>
      )}

      <Text style={{ marginHorizontal: 4, fontSize: 10, color: tokens.color.sub, textAlign: 'center', marginTop: 6 }}>
        Adding a child: their school, their code (RAF-00042) and password — once.{'\n'}Each child keeps their own
        notifications, badges and data.
      </Text>
    </Screen>
  );
}
