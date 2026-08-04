import { useState } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { AuthButton, AuthLink, AuthNote, AuthScaffold, Field, fieldInputStyle } from '@/components/AuthScaffold';
import { Toast } from '@/components/ui';
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

  const canSubmit = !busy && !!identifier && !!password;

  return (
    <AuthScaffold
      title="Welcome back"
      subtitle="Use the student code on your school letter (like RAF-00042), or your email."
    >
      {/* Deliberately NOT the mono/tracked treatment the reset screen's code
          field gets: this one field accepts a code, an email or an admission
          number, and an email set in the figure face with wide tracking reads
          as a serial number rather than as an address. */}
      <Field label="Student code or email">
        <TextInput
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="RAF-00042"
          placeholderTextColor={tokens.color.placeholder}
          autoCapitalize="none"
          testID="login-id"
          onFocus={() => setFocus('id')}
          onBlur={() => setFocus(null)}
          style={fieldInputStyle(tokens, { focused: focus === 'id' })}
        />
      </Field>
      {/* The label names the two people actually type; the third accepted
          identifier is said here rather than crammed into the label, which the
          `.fld` treatment keeps to a couple of tracked words. */}
      <AuthNote>An admission number works here too.</AuthNote>
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
      {/* The shared slip (`.resetok` skinned red) rather than a bespoke box —
          a refusal at the gate is the same object as a refusal anywhere else in
          the app, and it stays on the page instead of flashing past. */}
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
    </AuthScaffold>
  );
}
