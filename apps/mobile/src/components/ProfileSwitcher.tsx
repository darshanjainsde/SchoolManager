import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError, type OtpProfile } from '@/lib/api';
import { family } from '@/lib/family-store';
import { portalForRole } from '@/lib/roles';
import { LoadingRows } from '@/components/Loading';
import { Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * SWITCH PROFILE (design §5). Everything this session's phone number opens,
 * minus the one that is open. A tap asks the server for that profile's
 * tokens (it re-checks the shared number), puts the new session on the
 * shelf as its own spine, and lands on that role's home. Another school is
 * just another spine with its own host — exactly how siblings already work.
 * Renders nothing when the number opens only this profile.
 */
export function ProfileSwitcher({ testID = 'profile-switcher' }: { testID?: string }) {
  const tokens = useTokens();
  const [list, setList] = useState<OtpProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api.profiles()
        .then((r) => { if (!cancelled) setList(r.profiles.filter((p) => p.userId !== r.current)); })
        .catch(() => { if (!cancelled) setList([]); });
      return () => { cancelled = true; };
    }, []),
  );

  async function open(p: OtpProfile) {
    if (busy) return;
    setBusy(p.userId); setError(null);
    try {
      const s = await api.switchProfile(p);
      await family.add(s);
      router.replace(portalForRole(s.role));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open that profile.');
      setBusy(null);
    }
  }

  if (list === null) return <LoadingRows label="Checking this number…" rows={1} />;
  if (list.length === 0) return null;

  return (
    <View testID={testID} style={{ gap: 6 }}>
      <Text style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: tokens.color.sub, fontWeight: '700', paddingHorizontal: 4 }}>Also on this number</Text>
      {list.map((p) => (
        <Pressable
          key={p.userId}
          testID={`switch-${p.userId}`}
          accessibilityRole="button"
          accessibilityLabel={`Open as ${p.label}`}
          disabled={busy !== null}
          onPress={() => void open(p)}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12,
            backgroundColor: pressed ? tokens.color.indigo50 : tokens.color.surface, borderWidth: 1, borderColor: tokens.color.line, minHeight: 56,
          })}
        >
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tokens.color.indigo, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: tokens.color.onBrand, fontWeight: '800', fontSize: 13 }}>{initials(p.label)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '700', color: tokens.color.ink }}>{busy === p.userId ? 'Opening…' : p.label}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: tokens.color.sub }}>{p.sub} · {p.schoolName}</Text>
          </View>
        </Pressable>
      ))}
      {error ? <Toast kind="error" message={error} /> : null}
    </View>
  );
}
