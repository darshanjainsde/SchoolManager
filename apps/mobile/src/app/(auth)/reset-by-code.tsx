import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { AuthScaffold } from '@/components/AuthScaffold';
import { session } from '@/lib/session';
import { useTokens } from '@/theme/theme-context';

/** The shape the school prints on the letter: three letters, a dash, digits. */
const CODE_RE = /^[A-Za-z]{3}-\d{5,}$/;

/**
 * "I have the code, not the email" (Phase 5·1's `POST /auth/reset-by-code`).
 *
 * The family who needs this is the family who cannot sign in, so it asks for
 * the ONE thing the school definitely gave them — the student code — and
 * sends the reset link to whatever email is on file, showing that address
 * masked so they know which inbox to open. If nothing is on file the copy
 * says to ring the office rather than pretending a mail was sent.
 */
export default function ResetByCode() {
  const tokens = useTokens();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null | undefined>(undefined);

  const normalised = code.trim().toUpperCase();
  const canSubmit = !busy && CODE_RE.test(normalised);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const host = (await session.getSchoolHost())!;
      const res = await api.resetByCode(host, normalised);
      setSentTo(res.emailMasked);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally {
      setBusy(false);
    }
  };

  // `undefined` = not asked yet; `string` = mail sent there; `null` = no email
  // on file for that code.
  if (sentTo !== undefined) {
    return (
      <AuthScaffold title="Check the inbox" subtitle={`Student code ${normalised}`}>
        <Text testID="reset-result" style={{ color: tokens.color.ink, fontSize: 14.5, lineHeight: 21 }}>
          {sentTo
            ? `We've emailed a link to ${sentTo}. It works once, and expires in 30 minutes.`
            : 'That code has no email on file, so there is nowhere to send a link. Ring the school office and they can set the password for you.'}
        </Text>
        <Pressable
          testID="reset-back"
          onPress={() => router.replace('/(auth)/login')}
          style={({ pressed }) => ({
            backgroundColor: tokens.color.indigo,
            opacity: pressed ? 0.85 : 1,
            borderRadius: 14,
            paddingVertical: 16,
          })}
        >
          <Text
            style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center', fontSize: 16 }}
          >
            Back to log in
          </Text>
        </Pressable>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Forgot the password?"
      subtitle="Type the student code from your school letter and we’ll send a reset link to the email on file."
    >
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="RAF-00042"
        placeholderTextColor={tokens.color.placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="reset-code"
        style={{
          backgroundColor: tokens.color.appBg,
          borderColor: tokens.color.line,
          borderWidth: 1.5,
          borderRadius: 14,
          paddingVertical: 15,
          paddingHorizontal: 16,
          fontSize: 16,
          letterSpacing: 1,
          color: tokens.color.ink,
        }}
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
        testID="reset-send"
        onPress={submit}
        disabled={!canSubmit}
        style={({ pressed }) => ({
          backgroundColor: tokens.color.indigo,
          opacity: !canSubmit ? 0.45 : pressed ? 0.85 : 1,
          borderRadius: 14,
          paddingVertical: 16,
        })}
      >
        <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center', fontSize: 16 }}>
          {busy ? 'Sending…' : 'Send the reset link'}
        </Text>
      </Pressable>
      <Pressable testID="reset-cancel" onPress={() => router.back()}>
        <Text style={{ color: tokens.color.sub, fontWeight: '600', textAlign: 'center', fontSize: 13.5 }}>
          Back
        </Text>
      </Pressable>
    </AuthScaffold>
  );
}
