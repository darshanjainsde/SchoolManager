import { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { AuthScaffold } from '@/components/AuthScaffold';
import { session } from '@/lib/session';
import { tokens } from '@/theme/tokens';

export default function Connect() {
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
      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="school code"
        placeholderTextColor="#9AA4B2"
        testID="school-code"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          backgroundColor: tokens.color.appBg,
          borderColor: focused ? tokens.color.indigo : tokens.color.line,
          borderWidth: 1.5,
          borderRadius: 14,
          paddingVertical: 15,
          paddingHorizontal: 16,
          fontSize: 16,
          color: tokens.color.ink,
        }}
      />
      <Pressable
        disabled={!valid}
        onPress={next}
        testID="connect-btn"
        style={({ pressed }) => ({
          backgroundColor: tokens.color.indigo,
          opacity: !valid ? 0.45 : pressed ? 0.85 : 1,
          borderRadius: 14,
          paddingVertical: 16,
          transform: [{ scale: pressed && valid ? 0.98 : 1 }],
        })}
      >
        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 16 }}>
          Continue
        </Text>
      </Pressable>
    </AuthScaffold>
  );
}
