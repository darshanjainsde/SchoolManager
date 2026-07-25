import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SckoolsLogo } from '@/components/SckoolsLogo';
import { session } from '@/lib/session';
import { tokens } from '@/theme/tokens';

export default function Connect() {
  const [code, setCode] = useState('');
  const valid = /^[a-z0-9-]{2,40}$/.test(code.trim().toLowerCase());

  const next = async () => {
    await session.setSchoolHost(`${code.trim().toLowerCase()}.sckools.com`);
    router.push('/(auth)/login');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: tokens.color.appBg, justifyContent: 'center', padding: 24, gap: tokens.gap }}>
      <View style={{ alignItems: 'center', marginBottom: 8 }}><SckoolsLogo size={44} /></View>
      <Text style={{ fontSize: 22, fontWeight: '800', color: tokens.color.ink, textAlign: 'center' }}>
        Connect your school
      </Text>
      <Text style={{ color: tokens.color.sub, textAlign: 'center' }}>
        Enter the school code from your school (e.g. “raffles”).
      </Text>
      <TextInput
        value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false}
        placeholder="school code" testID="school-code"
        style={{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line, borderWidth: 1,
          borderRadius: 14, padding: 14, fontSize: 16 }}
      />
      <Pressable disabled={!valid} onPress={next} testID="connect-btn"
        style={{ backgroundColor: tokens.color.indigo, opacity: valid ? 1 : 0.5, borderRadius: 14, padding: 15 }}>
        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 15 }}>Continue</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
