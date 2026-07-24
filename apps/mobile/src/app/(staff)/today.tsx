import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';
import { todayISO, type ClassDayStatus } from '@/lib/attendance';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

export default function Today() {
  const [name, setName] = useState<string | null>(null);
  const [rows, setRows] = useState<ClassDayStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      session.get().then((s) => {
        if (!cancelled) setName(s?.displayName ?? null);
      });
      api
        .request<ClassDayStatus[]>(`/manage/attendance/status?date=${todayISO()}`)
        .then((data) => {
          if (!cancelled) setRows(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const pending = rows?.filter((r) => !r.taken).length ?? 0;
  const taken = rows?.filter((r) => r.taken).length ?? 0;

  return (
    <Screen>
      <SectionTitle title={name ? `Good day, ${name}` : 'Today'} />
      <Card>
        <Text style={{ color: tokens.color.sub, fontSize: 12.5 }}>
          {rows === null
            ? 'Loading your schedule…'
            : `${rows.length} class${rows.length === 1 ? '' : 'es'} today · ${taken} taken · ${pending} pending`}
        </Text>
      </Card>
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {rows?.length === 0 && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>No classes assigned to you yet.</Text>
        </Card>
      )}
      {rows && rows.length > 0 && (
        <Card style={{ paddingVertical: 2 }}>
          {rows.map((c) => (
            <View
              key={c.classSectionId}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: tokens.color.line,
              }}
            >
              <Text style={{ fontWeight: '600', color: tokens.color.ink }}>{c.name}</Text>
              {c.taken ? (
                <Pill tone="green">{`✓ ${c.present}/${c.total} present`}</Pill>
              ) : (
                <Pressable
                  testID={`today-take-${c.classSectionId}`}
                  onPress={() =>
                    router.push(`/(staff)/take/${c.classSectionId}?name=${encodeURIComponent(c.name)}`)
                  }
                >
                  <Pill tone="amber">Take attendance</Pill>
                </Pressable>
              )}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
