import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type OtpProfile, type OtpRequested } from '@/lib/api';
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
 * THE FRONT DOOR. Phone first (design §5): the number the school has for
 * you, a six-digit code on WhatsApp, in. The password door stays for anyone
 * who wants it and for logins without a phone; the Open Doors gate behind
 * it still resolves the school from a code or an email.
 *
 * One number can open several profiles — two children, a teacher who is
 * also a parent, children at two schools. Then the chooser lists them; the
 * pick becomes a spine on the shelf and the others are one tap away later.
 */
type Mode = 'phone' | 'password';
type Step = 'phone' | 'code' | 'choose';
const RESEND_AFTER_S = 60;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function Login() {
  const { scheme, tokens } = useTheme();
  const dark = scheme === 'dark';
  const g: GatePalette = dark ? brand.gate.dark : brand.gate.light;
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<'phone' | 'code' | 'id' | 'pw' | null>(null);

  // Phone door state
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [req, setReq] = useState<OtpRequested | null>(null);
  const [choice, setChoice] = useState<{ ticket: string; profiles: OtpProfile[] } | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  // Password door state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const finish = async (s: Session) => {
    // Every routable role gets a spine: the shelf is where a switch later lands.
    try {
      portalForRole(s.role);
    } catch (roleErr) {
      await session.clear();
      setError(roleErr instanceof Error ? roleErr.message : 'Owner accounts use the web console.');
      return;
    }
    await family.add(s);
    router.replace(portalForRole(s.role));
  };

  // ── Phone door ──
  const sendCode = async () => {
    if (!phone.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.otpRequest(phone.trim());
      setReq(r); setCode(''); setStep('code'); setLeft(RESEND_AFTER_S);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally { setBusy(false); }
  };
  const verifyCode = async () => {
    if (!req || code.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.otpVerify(req.challengeId, code);
      if (r.choose) { setChoice({ ticket: r.ticket, profiles: r.profiles }); setStep('choose'); }
      else await finish(await api.sessionFor(r.host, r, r.profile.label));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally { setBusy(false); }
  };
  const choose = async (p: OtpProfile) => {
    if (!choice || busy) return;
    setBusy(true); setError(null);
    try {
      await finish(await api.otpChoose(choice.ticket, p));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open that profile.');
    } finally { setBusy(false); }
  };

  // ── Password door (unchanged: the identifier carries the school) ──
  const submitPassword = async () => {
    setBusy(true);
    setError(null);
    const id = identifier.trim();
    try {
      const stored = await session.getSchoolHost();
      const tried: string[] = [];
      let lastRefusal: ApiError | null = null;
      const attempt = async (host: string): Promise<Session | null> => {
        tried.push(host);
        try {
          return await api.login(host, id, password);
        } catch (e) {
          if (e instanceof ApiError && e.status !== 0) { lastRefusal = e; return null; }
          throw e;
        }
      };
      let s: Session | null = stored ? await attempt(stored) : null;
      if (!s) {
        const hosts = (await api.resolveSchool(id)).filter((h) => !tried.includes(h));
        for (const host of hosts) { s = await attempt(host); if (s) break; }
      }
      if (s) await finish(s);
      else setError((lastRefusal as ApiError | null)?.message ?? 'Login failed — check your details.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmitPassword = !busy && !!identifier && !!password;
  const sub = tokens.color.sub;

  const modeTab = (m: Mode, label: string) => (
    <Pressable
      key={m}
      testID={`login-mode-${m}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: mode === m }}
      onPress={() => { setMode(m); setError(null); }}
      style={{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center', backgroundColor: mode === m ? tokens.color.surface : 'transparent' }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: mode === m ? tokens.color.ink : sub }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: g.bgBottom }}>
      <OpenDoorsScene />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', padding: 14 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: g.sheetFill, borderWidth: 1, borderColor: g.sheetBorder, borderRadius: 24, padding: 18, gap: 12,
              marginBottom: Math.max(insets.bottom, 6), shadowColor: brand.hero.shadow, shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <SckoolsLogo size={22} theme={dark ? 'dark' : 'light'} />
            </View>
            <View style={{ gap: 3 }}>
              <Text style={{ fontFamily: font.serif, fontSize: 21, fontWeight: '600', letterSpacing: -0.2, color: tokens.color.ink }}>Welcome back</Text>
              <Text style={{ fontSize: 12, lineHeight: 17, color: sub }}>
                {mode === 'phone' ? 'Your mobile number is all it takes — a code comes on WhatsApp.' : 'Your student code (like RAF-00042) or email is all it takes — no school code.'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: tokens.color.appBg }}>
              {modeTab('phone', 'Mobile number')}
              {modeTab('password', 'Email & password')}
            </View>

            {mode === 'phone' && step === 'phone' ? (
              <>
                <Field label="Mobile number">
                  <TextInput
                    value={phone} onChangeText={setPhone} placeholder="98765 43210" placeholderTextColor={tokens.color.placeholder}
                    keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" testID="otp-phone"
                    onFocus={() => setFocus('phone')} onBlur={() => setFocus(null)} style={fieldInputStyle(tokens, { focused: focus === 'phone' })}
                  />
                </Field>
                {error ? <Toast kind="error" message={error} /> : null}
                <AuthButton testID="otp-send" onPress={sendCode} disabled={busy || !phone.trim()} label={busy ? 'Sending…' : 'Send code'} />
              </>
            ) : null}

            {mode === 'phone' && step === 'code' && req ? (
              <>
                <Field label="The 6-digit code">
                  <TextInput
                    value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="482911" placeholderTextColor={tokens.color.placeholder}
                    keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus testID="otp-code"
                    onFocus={() => setFocus('code')} onBlur={() => setFocus(null)} style={fieldInputStyle(tokens, { focused: focus === 'code', mono: true })}
                  />
                </Field>
                <Text style={{ fontSize: 12, color: sub }}>
                  Sent to {req.phoneMasked} on {req.sentVia.length ? req.sentVia.map((v) => (v === 'sms' ? 'SMS' : 'WhatsApp')).join(' and ') : 'WhatsApp'}. It works for 10 minutes.
                </Text>
                {error ? <Toast kind="error" message={error} /> : null}
                <AuthButton testID="otp-verify" onPress={verifyCode} disabled={busy || code.length !== 6} label={busy ? 'Checking…' : 'Open'} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <AuthLink testID="otp-resend" label={left > 0 ? `Send again in ${left}s` : 'Send the code again'} onPress={() => { if (left <= 0) void sendCode(); }} tone={left > 0 ? 'muted' : 'accent'} />
                  <AuthLink testID="otp-change" label="Change number" onPress={() => { setStep('phone'); setError(null); }} />
                </View>
              </>
            ) : null}

            {mode === 'phone' && step === 'choose' && choice ? (
              <View style={{ gap: 8 }} testID="otp-choose">
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: tokens.color.ink }}>Who are you opening for?</Text>
                <Text style={{ fontSize: 12, color: sub }}>This number is on more than one profile. The others stay one tap away on the shelf.</Text>
                {choice.profiles.map((p) => (
                  <Pressable
                    key={p.userId} testID={`otp-choice-${p.userId}`} accessibilityRole="button" accessibilityLabel={`Open as ${p.label}`}
                    disabled={busy} onPress={() => void choose(p)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, minHeight: 56, backgroundColor: pressed ? tokens.color.indigo50 : tokens.color.surface, borderWidth: 1, borderColor: tokens.color.line })}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tokens.color.indigo, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: tokens.color.onBrand, fontWeight: '800', fontSize: 13 }}>{initials(p.label)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '700', color: tokens.color.ink }}>{p.label}</Text>
                      <Text numberOfLines={1} style={{ fontSize: 12, color: sub }}>{p.sub} · {p.schoolName}</Text>
                    </View>
                  </Pressable>
                ))}
                {error ? <Toast kind="error" message={error} /> : null}
                <AuthLink testID="otp-change" label="Use a different number" onPress={() => { setStep('phone'); setChoice(null); setError(null); }} />
              </View>
            ) : null}

            {mode === 'password' ? (
              <>
                <Field label="Student code or email">
                  <TextInput
                    value={identifier} onChangeText={setIdentifier} placeholder="RAF-00042" placeholderTextColor={tokens.color.placeholder}
                    autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" textContentType="username" testID="login-id"
                    onFocus={() => setFocus('id')} onBlur={() => setFocus(null)} style={fieldInputStyle(tokens, { focused: focus === 'id' })}
                  />
                </Field>
                <Field label="Password">
                  <TextInput
                    value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={tokens.color.placeholder}
                    secureTextEntry autoComplete="password" textContentType="password" testID="login-pw"
                    onFocus={() => setFocus('pw')} onBlur={() => setFocus(null)} style={fieldInputStyle(tokens, { focused: focus === 'pw' })}
                  />
                </Field>
                {error ? <Toast kind="error" message={error} /> : null}
                <AuthButton testID="login-btn" onPress={submitPassword} disabled={!canSubmitPassword} label={busy ? 'Logging in…' : 'Log in'} />
                <AuthLink testID="login-forgot" label="Forgot the password?" onPress={() => router.push('/(auth)/reset-by-code')} />
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
