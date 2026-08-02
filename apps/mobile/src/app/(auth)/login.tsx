import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { AuthScaffold } from '@/components/AuthScaffold';
import { family } from '@/lib/family-store';
import { session } from '@/lib/session';
import { portalForRole } from '@/lib/roles';
import { useTokens } from '@/theme/theme-context';

export default function Login() {
  const tokens = useTokens();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<'id' | 'pw' | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const host = (await session.getSchoolHost())!;
      const s = await api.login(host, identifier.trim(), password);
      // A STUDENT sign-in lands on the family shelf (Phase 5·2): upsert by
      // host+name, so adding the same child twice just refreshes tokens.
      if (s.role === 'STUDENT') await family.add(s);
      // api.login() already persisted `s` before returning. If the role can't
      // be routed on mobile (OWNER — web-only), that persisted session must
      // not survive: leaving it behind would brick the next app launch (see
      // resolveStartRoute in @/lib/roles). Show the real reason instead of
      // letting it fall into the generic connectivity-error branch below.
      try {
        router.replace(portalForRole(s.role));
      } catch (roleErr) {
        await session.clear();
        setError(roleErr instanceof Error ? roleErr.message : 'Owner accounts use the web console.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = (key: 'id' | 'pw') => ({
    backgroundColor: tokens.color.appBg,
    borderColor: focus === key ? tokens.color.indigo : tokens.color.line,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    fontSize: 16,
    color: tokens.color.ink,
  });

  const canSubmit = !busy && !!identifier && !!password;

  return (
    <AuthScaffold title="Welcome back" subtitle="Log in with the details your school gave you.">
      <TextInput
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="Email or admission number"
        placeholderTextColor={tokens.color.placeholder}
        autoCapitalize="none"
        testID="login-id"
        onFocus={() => setFocus('id')}
        onBlur={() => setFocus(null)}
        style={inputStyle('id')}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={tokens.color.placeholder}
        secureTextEntry
        testID="login-pw"
        onFocus={() => setFocus('pw')}
        onBlur={() => setFocus(null)}
        style={inputStyle('pw')}
      />
      {error ? (
        <View
          style={{
            backgroundColor: tokens.color.red50,
            borderRadius: 12,
            paddingVertical: 10,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ color: tokens.color.red, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        testID="login-btn"
        style={({ pressed }) => ({
          backgroundColor: tokens.color.indigo,
          opacity: !canSubmit ? 0.45 : pressed ? 0.85 : 1,
          borderRadius: 14,
          paddingVertical: 16,
          transform: [{ scale: pressed && canSubmit ? 0.98 : 1 }],
        })}
      >
        <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center', fontSize: 16 }}>
          {busy ? 'Logging in…' : 'Log in'}
        </Text>
      </Pressable>
    </AuthScaffold>
  );
}
