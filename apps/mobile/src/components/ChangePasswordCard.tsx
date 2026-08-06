import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { Card, Toast } from '@/components/ui';
import { Field, fieldInputStyle } from '@/components/AuthScaffold';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * Change password, on the Profile screen of BOTH portals (pitch-№3 follow-up:
 * "Change your password on the web portal" was a dead end on the device in
 * your hand). POST /auth/change-password works for every school role, so one
 * card serves both; the copy stays role-neutral — a STUDENT login is shared
 * by student and family until the pay module ships a PARENT role.
 *
 * The server verifies the current password and enforces the 8-character
 * minimum; both are ALSO checked here so the common mistakes never cost a
 * round-trip. A refusal surfaces the server's message verbatim.
 */
export function ChangePasswordCard() {
  const tokens = useTokens();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [focus, setFocus] = useState<'cur' | 'new' | 'confirm' | null>(null);

  // Local refusals, decided before any request: the button stays enabled so
  // tapping it can EXPLAIN what is missing rather than sitting inert.
  const localProblem = (): string | null => {
    if (!current) return 'Enter your current password first.';
    if (next.length < 8) return 'The new password needs at least 8 characters.';
    if (next !== confirm) return 'The new passwords do not match.';
    return null;
  };

  const submit = async () => {
    const problem = localProblem();
    if (problem) {
      setDone(false);
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.changePassword(current, next);
      // Success clears the fields: a password must not linger on a screen
      // that stays open, and the cleared form is its own "it worked".
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally {
      setBusy(false);
    }
  };

  const inputProps = {
    autoCapitalize: 'none' as const,
    autoCorrect: false,
    secureTextEntry: true,
    placeholder: '••••••••',
    placeholderTextColor: tokens.color.placeholder,
  };

  return (
    <Card style={{ gap: 11 }}>
      <Text
        style={{
          fontFamily: font.serif,
          fontSize: 16,
          fontWeight: '700',
          color: tokens.color.ink,
        }}
      >
        Change password
      </Text>
      <Field label="Current password">
        <TextInput
          {...inputProps}
          testID="pw-current"
          value={current}
          onChangeText={setCurrent}
          onFocus={() => setFocus('cur')}
          onBlur={() => setFocus(null)}
          style={fieldInputStyle(tokens, { focused: focus === 'cur' })}
        />
      </Field>
      <Field label="New password">
        <TextInput
          {...inputProps}
          testID="pw-new"
          value={next}
          onChangeText={setNext}
          onFocus={() => setFocus('new')}
          onBlur={() => setFocus(null)}
          style={fieldInputStyle(tokens, { focused: focus === 'new' })}
        />
      </Field>
      <Field label="New password, again">
        <TextInput
          {...inputProps}
          testID="pw-confirm"
          value={confirm}
          onChangeText={setConfirm}
          onFocus={() => setFocus('confirm')}
          onBlur={() => setFocus(null)}
          style={fieldInputStyle(tokens, { focused: focus === 'confirm' })}
        />
      </Field>
      <Text style={{ fontSize: 11, color: tokens.color.sub }}>
        At least 8 characters. Changing it signs nobody out — the next sign-in
        just needs the new one.
      </Text>
      {error ? <Toast testID="pw-error" kind="error" message={error} /> : null}
      {done ? <Toast testID="pw-done" kind="success" message="Password changed." /> : null}
      <Pressable
        testID="pw-submit"
        accessibilityRole="button"
        onPress={submit}
        disabled={busy}
        style={({ pressed }) => ({
          backgroundColor: tokens.color.indigo,
          borderRadius: 12,
          paddingVertical: 12,
          opacity: busy ? 0.55 : pressed ? 0.75 : 1,
        })}
      >
        <Text
          style={{
            color: tokens.color.onBrand,
            fontWeight: '700',
            fontSize: 13.5,
            textAlign: 'center',
          }}
        >
          {busy ? 'Changing…' : 'Change password'}
        </Text>
      </Pressable>
    </Card>
  );
}
