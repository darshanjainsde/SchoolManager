import { useState } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { AuthButton, AuthNote, AuthScaffold, Field, fieldInputStyle } from '@/components/AuthScaffold';
import { session } from '@/lib/session';
import { useTokens } from '@/theme/theme-context';

export default function Connect() {
  const tokens = useTokens();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const valid = /^[a-z0-9-]{2,40}$/.test(code.trim().toLowerCase());

  const next = async () => {
    await session.setSchoolHost(`${code.trim().toLowerCase()}.sckools.com`);
    router.push('/(auth)/login');
  };

  return (
    <AuthScaffold
      title="Connect your school"
      subtitle="Enter the school code your school gave you (e.g. “raffles”)."
    >
      {/* No `.door` cards here, deliberately: the pitch's doors are for a
          screen that offers a CHOICE (which role, which school), and this one
          asks for a single typed value. A door with one door in it is just a
          field wearing a bigger box. */}
      <Field label="School code">
        <TextInput
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="raffles"
          placeholderTextColor={tokens.color.placeholder}
          testID="school-code"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // A school code is a WORD ("raffles"), not a serial, so it stays in
          // the UI sans — the mono/tracked treatment is reserved for the
          // student code, which is read character by character.
          style={fieldInputStyle(tokens, { focused })}
        />
      </Field>
      <AuthNote>It&rsquo;s the first part of your school&rsquo;s Sckools web address.</AuthNote>
      <AuthButton testID="connect-btn" onPress={next} disabled={!valid} label="Continue" />
    </AuthScaffold>
  );
}
