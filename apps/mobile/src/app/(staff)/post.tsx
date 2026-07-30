import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { MyClassSection } from '@/lib/attendance';
import { ClassChips } from '@/components/ClassChips';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

export default function Post() {
  const tokens = useTokens();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
  };
  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  // Refetch on focus — a teacher may have picked up/lost a class assignment
  // since the last visit.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoadError(null);
      api
        .request<MyClassSection[]>('/manage/attendance/my-classes')
        .then((data) => {
          if (!cancelled) setClasses(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoadError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const n = selected.length;
  const canSubmit = n > 0 && title.trim().length > 0 && body.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    setPosted(false);
    try {
      await api.request('/manage/announcements', {
        method: 'POST',
        body: { title: title.trim(), body: body.trim(), classSectionIds: selected },
      });
      setTitle('');
      setBody('');
      setSelected([]);
      setPosted(true);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : 'Could not post — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionTitle title="Announcements" />
      {loadError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{loadError}</Text>
        </Card>
      )}
      {classes === null && !loadError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your classes…</Text>
        </Card>
      )}
      {classes?.length === 0 && !loadError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You have no classes assigned yet.</Text>
        </Card>
      )}
      {classes && classes.length > 0 && (
        <Card>
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub, marginBottom: 8 }}>
            Send to — tap to select multiple
          </Text>
          <ClassChips
            classes={classes.map((c) => ({ classSectionId: c.classSectionId, name: c.name }))}
            selected={selected}
            onChange={setSelected}
          />
        </Card>
      )}
      {classes && classes.length > 0 && (
        <Card style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub, marginBottom: 5 }}>
              Title
            </Text>
            <TextInput
              testID="post-title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Chapter 4 comprehension"
              placeholderTextColor={tokens.color.sub}
              style={inputStyle}
            />
          </View>
          <View>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub, marginBottom: 5 }}>
              Details
            </Text>
            <TextInput
              testID="post-body"
              value={body}
              onChangeText={setBody}
              placeholder="Add instructions, due date…"
              placeholderTextColor={tokens.color.sub}
              multiline
              style={[inputStyle, { minHeight: 74, textAlignVertical: 'top' }]}
            />
          </View>
        </Card>
      )}
      {submitError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{submitError}</Text>
        </Card>
      )}
      {posted && (
        <Card>
          <Text style={{ color: tokens.color.green, fontWeight: '700' }}>Posted ✓</Text>
        </Card>
      )}
      {classes && classes.length > 0 && (
        <Pressable
          testID="post-submit"
          onPress={submit}
          disabled={!canSubmit}
          style={{
            backgroundColor: tokens.color.indigo,
            borderRadius: 14,
            padding: 15,
            opacity: canSubmit ? 1 : 0.6,
          }}
        >
          <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center' }}>
            {busy ? 'Posting…' : `Post to ${n} class${n === 1 ? '' : 'es'}`}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}
