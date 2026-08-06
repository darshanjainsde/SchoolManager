import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '@/lib/api';
import { AuthButton, AuthLink, Field, fieldInputStyle } from '@/components/AuthScaffold';
import { OpenDoorsScene } from '@/components/entry/OpenDoorsScene';
import { SckoolsLogo } from '@/components/SckoolsLogo';
import { Toast } from '@/components/ui';
import { family } from '@/lib/family-store';
import { session, type Session } from '@/lib/session';
import { portalForRole } from '@/lib/roles';
import { useTheme } from '@/theme/theme-context';
import { brand, font, type GatePalette } from '@/theme/tokens';

/**
 * The gate — the app's single entry screen (the approved Open Doors pitch).
 * The endless door-to-door walk owns the top two-thirds; this glass sheet
 * rests near the bottom. There is no school-code step any more: the
 * identifier itself carries the school (a student code's prefix, a staff
 * email), and `/auth/resolve-school` turns it into candidate hosts.
 *
 * Login order: the cached school host first (the offline-friendly path —
 * also why a same-school re-login never needs the resolver), then each
 * resolved candidate. The password decides; api.login persists the winning
 * host as the new cache.
 */
export default function Login() {
  const { scheme, tokens } = useTheme();
  const dark = scheme === 'dark';
  const g: GatePalette = dark ? brand.gate.dark : brand.gate.light;
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<'id' | 'pw' | null>(null);

  const finish = async (s: Session) => {
    // A STUDENT sign-in lands on the family shelf (Phase 5·2): upsert by
    // host+name, so adding the same child twice just refreshes tokens.
    if (s.role === 'STUDENT') await family.add(s);
    // api.login() already persisted `s` before returning. If the role can't
    // be routed on mobile (OWNER — web-only), that persisted session must
    // not survive: leaving it behind would brick the next app launch (see
    // resolveStartRoute in @/lib/roles).
    try {
      router.replace(portalForRole(s.role));
    } catch (roleErr) {
      await session.clear();
      setError(roleErr instanceof Error ? roleErr.message : 'Owner accounts use the web console.');
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const id = identifier.trim();
    try {
      // Candidate hosts, in order. `''` (shelf's add-a-child clears the cache
      // to exactly this) is falsy, so it never becomes a candidate.
      const stored = await session.getSchoolHost();
      const tried: string[] = [];
      let lastRefusal: ApiError | null = null;

      const attempt = async (host: string): Promise<Session | null> => {
        tried.push(host);
        try {
          return await api.login(host, id, password);
        } catch (e) {
          // status 0 = never reached a server — that's connectivity, not a
          // wrong school, so it must surface rather than be swallowed by the
          // try-the-next-candidate loop.
          if (e instanceof ApiError && e.status !== 0) {
            lastRefusal = e;
            return null;
          }
          throw e;
        }
      };

      let s: Session | null = stored ? await attempt(stored) : null;
      if (!s) {
        // The cache was absent or wrong — ask the platform which school(s)
        // this identifier belongs to and try each in turn.
        const hosts = (await api.resolveSchool(id)).filter((h) => !tried.includes(h));
        for (const host of hosts) {
          s = await attempt(host);
          if (s) break;
        }
      }

      if (s) {
        await finish(s);
      } else {
        // Neutral, whether the identifier is unknown everywhere or the
        // password was wrong at the right school.
        setError(
          (lastRefusal as ApiError | null)?.message ?? 'Login failed — check your details.',
        );
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && !!identifier && !!password;

  return (
    <View style={{ flex: 1, backgroundColor: g.bgBottom }}>
      <OpenDoorsScene />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', padding: 14 }}
      >
        {/* The glass sheet, anchored low: the walk keeps the rest of the
            screen. More opaque than the pitch's CSS (RN has no cheap blur,
            and the fields must stay readable over a moving scene). */}
        <View
          style={{
            backgroundColor: g.sheetFill,
            borderWidth: 1,
            borderColor: g.sheetBorder,
            borderRadius: 24,
            padding: 18,
            gap: 12,
            marginBottom: Math.max(insets.bottom, 6),
            shadowColor: brand.hero.shadow,
            shadowOpacity: 0.28,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 14 },
            elevation: 12,
          }}
        >
          {/* The logo's `full` variant draws its own wordmark — a second
              "Sckools" Text here rendered the name twice (caught on-device). */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <SckoolsLogo size={22} theme={dark ? 'dark' : 'light'} />
          </View>
          <View style={{ gap: 3 }}>
            <Text
              style={{
                fontFamily: font.serif,
                fontSize: 21,
                fontWeight: '600',
                letterSpacing: -0.2,
                color: tokens.color.ink,
              }}
            >
              Welcome back
            </Text>
            <Text style={{ fontSize: 12, lineHeight: 17, color: tokens.color.sub }}>
              Your student code or email is all it takes — no school code.
            </Text>
          </View>
          {/* One field for a code, an email or an admission number — so NOT
              the mono/tracked treatment (an email in the figure face reads as
              a serial number). */}
          <Field label="Student code or email">
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="RAF-00042"
              placeholderTextColor={tokens.color.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              testID="login-id"
              onFocus={() => setFocus('id')}
              onBlur={() => setFocus(null)}
              style={fieldInputStyle(tokens, { focused: focus === 'id' })}
            />
          </Field>
          <Field label="Password">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={tokens.color.placeholder}
              secureTextEntry
              testID="login-pw"
              onFocus={() => setFocus('pw')}
              onBlur={() => setFocus(null)}
              style={fieldInputStyle(tokens, { focused: focus === 'pw' })}
            />
          </Field>
          {error ? <Toast kind="error" message={error} /> : null}
          <AuthButton
            testID="login-btn"
            onPress={submit}
            disabled={!canSubmit}
            label={busy ? 'Logging in…' : 'Log in'}
          />
          <AuthLink
            testID="login-forgot"
            label="Forgot the password?"
            onPress={() => router.push('/(auth)/reset-by-code')}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
