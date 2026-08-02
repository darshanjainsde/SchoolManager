import { useState } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import {
  AuthButton,
  AuthLink,
  AuthNote,
  AuthScaffold,
  AuthSlip,
  Field,
  fieldInputStyle,
} from '@/components/AuthScaffold';
import { Toast } from '@/components/ui';
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
  const [focused, setFocused] = useState(false);
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
        {/* `.resetok`, in the two tones the pitch actually uses it in: green
            when a link is genuinely on its way, amber when the code was fine
            but there is no inbox to send it to. Dressing that second answer in
            green would be a false success — the family would sit waiting for a
            mail that was never sent. */}
        <AuthSlip tone={sentTo ? 'good' : 'warn'} testID="reset-result">
          {sentTo
            ? `We've emailed a link to ${sentTo}. It works once, and expires in 30 minutes.`
            : 'That code has no email on file, so there is nowhere to send a link. Ring the school office and they can set the password for you.'}
        </AuthSlip>
        <AuthButton
          testID="reset-back"
          onPress={() => router.replace('/(auth)/login')}
          label="Back to log in"
        />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Forgot the password?"
      subtitle="Type the student code from your school letter and we’ll send a reset link to the email on file."
    >
      {/* THE one field that has to be typed exactly, so it is the one field
          set in MONO with wide tracking: RAF-00042 is copied character by
          character off a printed letter, and fixed-width figures with air
          between them are what make an 0/O or a 1/l mismatch visible before
          the tap rather than after it. */}
      <Field label="Student code">
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="RAF-00042"
          placeholderTextColor={tokens.color.placeholder}
          autoCapitalize="characters"
          autoCorrect={false}
          testID="reset-code"
          style={fieldInputStyle(tokens, { focused: focused, mono: true })}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </Field>
      <AuthNote>Three letters, a dash, then the digits — exactly as printed on the school letter.</AuthNote>
      {error ? <Toast kind="error" message={error} /> : null}
      <AuthButton
        testID="reset-send"
        onPress={submit}
        disabled={!canSubmit}
        label={busy ? 'Sending…' : 'Send the reset link'}
      />
      <AuthLink testID="reset-cancel" tone="muted" label="Back" onPress={() => router.back()} />
    </AuthScaffold>
  );
}
