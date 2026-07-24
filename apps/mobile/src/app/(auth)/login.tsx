import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';
import { portalForRole } from '@/lib/roles';
import { tokens } from '@/theme/tokens';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const host = (await session.getSchoolHost())!;
      const s = await api.login(host, identifier.trim(), password);
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: tokens.color.appBg, justifyContent: 'center', padding: 24, gap: tokens.gap }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: tokens.color.ink }}>Log in</Text>
      <TextInput value={identifier} onChangeText={setIdentifier} placeholder="Email or admission number"
        autoCapitalize="none" testID="login-id"
        style={{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line, borderWidth: 1, borderRadius: 14, padding: 14 }} />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry testID="login-pw"
        style={{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line, borderWidth: 1, borderRadius: 14, padding: 14 }} />
      {error && <Text style={{ color: tokens.color.red }}>{error}</Text>}
      <Pressable onPress={submit} disabled={busy || !identifier || !password} testID="login-btn"
        style={{ backgroundColor: tokens.color.indigo, opacity: busy ? 0.6 : 1, borderRadius: 14, padding: 15 }}>
        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>{busy ? 'Logging in…' : 'Log in'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
