import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  CONCERN_CATEGORIES, CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL,
  type ConcernAudience, type ConcernCategory, type ConcernRow, type Profile,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { Chip, ChipRow } from '@/components/Chip';
import { Field, fieldInputStyle } from '@/components/AuthScaffold';
import { Card, Empty, ErrorState, Page, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';

/**
 * THE FAMILY'S COMPLAINT BOX on the phone.
 *
 * The button says "Raise a concern", not "Complain": a parent asking for a
 * water cooler is not complaining and will not press a button that says they
 * are. Who sees it is the family's own choice, shown BY NAME — and when the
 * class has no class teacher that choice is simply not offered, because a
 * choice that silently goes somewhere else is worse than no choice.
 *
 * Role-neutral copy throughout: parents and students share one login.
 */
export default function FamilyConcerns() {
  const tokens = useTokens();
  const [rows, setRows] = useState<ConcernRow[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ audience: ConcernAudience; category: ConcernCategory; title: string; body: string }>({
    audience: 'OFFICE', category: 'OTHER', title: '', body: '',
  });
  const [titleFocused, setTitleFocused] = useState(false);
  const [bodyFocused, setBodyFocused] = useState(false);
  // The keyboard's Next moves from the one-line title to the details box.
  const concernBodyRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([
        api.request<ConcernRow[]>('/me/concerns'),
        api.request<Profile>('/me/profile'),
      ]);
      setRows(list);
      setProfile(me);
      setError(null);
    } catch (e) {
      // Keep whatever was on screen. Blanking the rows here turned a lost
      // connection into "Nothing raised yet" — a false answer, and the one a
      // parent acts on by raising the same concern twice.
      setError(e instanceof ApiError ? e.message : 'That did not load.');
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const classTeacher = profile?.classTeacherName ?? null;
  const send = async () => {
    setBusy(true);
    try {
      await api.request<ConcernRow>('/me/concerns', { method: 'POST', body: form });
      setWriting(false);
      setForm({ audience: 'OFFICE', category: 'OTHER', title: '', body: '' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  };

  const eyebrow = { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: tokens.color.sub } as const;

  return (
    <Screen onRefresh={() => void load()}>
      {/* No second "Complaint Box": the back-chip header already says it (re-audit 2026-10-08). */}
      <Text style={{ fontSize: 14, color: tokens.color.sub, marginTop: 4, lineHeight: 20 }}>
        Tell the school something that needs looking at. You choose who sees it, and you can follow what happens here.
        {classTeacher ? ` Your class teacher is ${classTeacher}.` : ''}
      </Text>

      {error && rows !== null ? <Text style={{ marginTop: 10, fontSize: 13, color: tokens.color.red }}>{error}</Text> : null}

      {!writing && (
        <Button label="Raise a concern" onPress={() => setWriting(true)} variant="filled" block style={{ marginTop: 14 }} />
      )}

      {writing && (
        <Card style={{ marginTop: 14, gap: 12 }}>
          <View style={{ gap: 6 }}>
            <Text style={eyebrow}>WHO SHOULD SEE THIS</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Who should see this">
              <ChipRow>
                <Chip label="School office" selected={form.audience === 'OFFICE'} onPress={() => setForm({ ...form, audience: 'OFFICE' })} />
                {classTeacher && (
                  <Chip
                    label={`Class teacher · ${classTeacher}`}
                    selected={form.audience === 'CLASS_TEACHER'}
                    onPress={() => setForm({ ...form, audience: 'CLASS_TEACHER' })}
                  />
                )}
              </ChipRow>
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={eyebrow}>WHAT IS IT ABOUT</Text>
            <ChipRow>
              {CONCERN_CATEGORIES.map((k) => (
                <Chip key={k} label={CONCERN_CATEGORY_LABEL[k]} selected={form.category === k} onPress={() => setForm({ ...form, category: k })} />
              ))}
            </ChipRow>
          </View>

          <Field label="In one line">
            <TextInput
              accessibilityLabel="In one line"
              placeholder="The bus was late twice this week"
              placeholderTextColor={tokens.color.placeholder}
              value={form.title}
              onChangeText={(t) => setForm({ ...form, title: t })}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => concernBodyRef.current?.focus()}
              maxLength={160}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => setTitleFocused(false)}
              style={fieldInputStyle(tokens, { focused: titleFocused })}
            />
          </Field>
          <Field label="What happened">
            <TextInput
              accessibilityLabel="What happened"
              placeholder="Tell us what happened, and when."
              placeholderTextColor={tokens.color.placeholder}
              value={form.body}
              onChangeText={(t) => setForm({ ...form, body: t })}
              ref={concernBodyRef}
              maxLength={4000}
              multiline
              onFocus={() => setBodyFocused(true)}
              onBlur={() => setBodyFocused(false)}
              style={fieldInputStyle(tokens, { focused: bodyFocused, multiline: true })}
            />
          </Field>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label={busy ? 'Sending…' : 'Send it'}
              onPress={() => void send()}
              disabled={busy || form.title.trim().length < 3 || form.body.trim().length < 3}
              busy={busy}
              variant="filled"
              style={{ flex: 1 }}
            />
            <Button label="Not now" onPress={() => setWriting(false)} variant="outlined" />
          </View>
        </Card>
      )}

      <SectionTitle title="Your concerns" />
      {rows === null && error ? <ErrorState error={error} onRetry={() => void load()} /> : rows === null ? <LoadingRows label="Loading your concerns" rows={3} /> : rows.length === 0 ? (
        <Empty icon="concern">Nothing raised yet. If something needs the school&rsquo;s attention, raise it here and you will see what happens.</Empty>
      ) : (
        <Page>
          {rows.map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              testID={`concern-${r.id}`}
              onPress={() => router.push(`/(family)/(tabs)/home/concerns/${r.id}`)}
              style={{
                paddingHorizontal: 16, paddingVertical: 12, gap: 4, minHeight: 72, justifyContent: 'center',
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: tokens.color.line,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: tokens.color.ink }} numberOfLines={1}>{r.title}</Text>
                <Pill tone={r.status === 'RESOLVED' ? 'green' : r.status === 'IN_PROGRESS' ? 'amber' : 'indigo'}>
                  {CONCERN_STATUS_LABEL[r.status]}
                </Pill>
              </View>
              <Text style={{ fontSize: 13, color: tokens.color.sub }}>
                {CONCERN_CATEGORY_LABEL[r.category]} · {r.audience === 'CLASS_TEACHER' && r.assignedTeacher ? r.assignedTeacher.name : 'school office'}
              </Text>
            </Pressable>
          ))}
        </Page>
      )}
    </Screen>
  );
}
