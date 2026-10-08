import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  CONCERN_CATEGORIES, CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL,
  type ConcernAudience, type ConcernCategory, type ConcernRow, type Profile,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
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

  const inputStyle = {
    borderWidth: 1.5, borderColor: tokens.color.line, backgroundColor: tokens.color.surface,
    borderRadius: 12, padding: 11, color: tokens.color.ink, fontSize: 14,
  } as const;

  return (
    <Screen onRefresh={() => void load()}>
      {/* No second "Complaint Box": the back-chip header already says it (re-audit 2026-10-08). */}
      <Text style={{ fontSize: 13.5, color: tokens.color.sub, marginTop: 4, lineHeight: 19 }}>
        Tell the school something that needs looking at. You choose who sees it, and you can follow what happens here.
        {classTeacher ? ` Your class teacher is ${classTeacher}.` : ''}
      </Text>

      {error && rows !== null ? <Text style={{ marginTop: 10, fontSize: 13, color: tokens.color.red }}>{error}</Text> : null}

      {!writing && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setWriting(true)}
          style={{ marginTop: 14, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.indigo }}
        >
          <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 15 }}>Raise a concern</Text>
        </Pressable>
      )}

      {writing && (
        <Card style={{ marginTop: 14, gap: 12 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.sub }}>WHO SHOULD SEE THIS</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Who should see this" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Choice label="School office" on={form.audience === 'OFFICE'} onPress={() => setForm({ ...form, audience: 'OFFICE' })} />
              {classTeacher && (
                <Choice
                  label={`Class teacher · ${classTeacher}`}
                  on={form.audience === 'CLASS_TEACHER'}
                  onPress={() => setForm({ ...form, audience: 'CLASS_TEACHER' })}
                />
              )}
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.sub }}>WHAT IS IT ABOUT</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CONCERN_CATEGORIES.map((k) => (
                <Choice key={k} label={CONCERN_CATEGORY_LABEL[k]} on={form.category === k} onPress={() => setForm({ ...form, category: k })} />
              ))}
            </View>
          </View>

          <TextInput
            accessibilityLabel="In one line"
            placeholder="The bus was late twice this week"
            placeholderTextColor={tokens.color.sub}
            value={form.title}
            onChangeText={(t) => setForm({ ...form, title: t })}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => concernBodyRef.current?.focus()}
            maxLength={160}
            style={inputStyle}
          />
          <TextInput
            accessibilityLabel="What happened"
            placeholder="Tell us what happened, and when."
            placeholderTextColor={tokens.color.sub}
            value={form.body}
            onChangeText={(t) => setForm({ ...form, body: t })}
            ref={concernBodyRef}
            maxLength={4000}
            multiline
            style={{ ...inputStyle, minHeight: 96, textAlignVertical: 'top' }}
          />

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={busy || form.title.trim().length < 3 || form.body.trim().length < 3}
              onPress={() => void send()}
              style={{
                flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                backgroundColor: form.title.trim().length >= 3 && form.body.trim().length >= 3 ? tokens.color.indigo : tokens.color.line,
              }}
            >
              <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 14.5 }}>{busy ? 'Sending…' : 'Send it'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setWriting(false)}
              style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: tokens.color.line }}
            >
              <Text style={{ color: tokens.color.ink, fontWeight: '700', fontSize: 14.5 }}>Not now</Text>
            </Pressable>
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
                padding: 13, gap: 4, minHeight: 64,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: tokens.color.line,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: tokens.color.ink }} numberOfLines={1}>{r.title}</Text>
                <Pill tone={r.status === 'RESOLVED' ? 'green' : r.status === 'IN_PROGRESS' ? 'amber' : 'indigo'}>
                  {CONCERN_STATUS_LABEL[r.status]}
                </Pill>
              </View>
              <Text style={{ fontSize: 12, color: tokens.color.sub }}>
                {CONCERN_CATEGORY_LABEL[r.category]} · {r.audience === 'CLASS_TEACHER' && r.assignedTeacher ? r.assignedTeacher.name : 'school office'}
              </Text>
            </Pressable>
          ))}
        </Page>
      )}
    </Screen>
  );
}

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const tokens = useTokens();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: 40, paddingHorizontal: 13, borderRadius: 999, justifyContent: 'center',
        borderWidth: 1.5, borderColor: on ? tokens.color.indigo : tokens.color.line,
        backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? tokens.color.indigo : tokens.color.ink }}>{label}</Text>
    </Pressable>
  );
}
