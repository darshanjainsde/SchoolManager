import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { todayISO, type ClassDayStatus } from '@/lib/attendance';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

export default function StaffAttendance() {
  const [rows, setRows] = useState<ClassDayStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch every time this tab regains focus (not just on mount) so a class
  // another teacher just marked shows as locked without a manual reload.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
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

  const goTake = (c: ClassDayStatus) =>
    router.push(`/(staff)/take/${c.classSectionId}?name=${encodeURIComponent(c.name)}`);

  const confirmRetake = (c: ClassDayStatus) =>
    Alert.alert(
      `Retake attendance for ${c.name}?`,
      `${c.name} was already marked by ${c.markedBy ?? 'a teacher'} today — ` +
        `${c.present}/${c.total} present. Retaking overwrites the record for every ` +
        'teacher today. The previous version stays in the audit log.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retake', style: 'destructive', onPress: () => goTake(c) },
      ],
    );

  return (
    <Screen>
      <SectionTitle title="Attendance · today" />
      <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginHorizontal: 4 }}>
        One record per class per day. Once any teacher takes it, it locks for everyone —
        retake needs confirmation.
      </Text>
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {rows === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your classes…</Text>
        </Card>
      )}
      {rows?.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            You have no classes assigned for attendance yet.
          </Text>
        </Card>
      )}
      {rows?.map((c) => (
        <Card key={c.classSectionId}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <View>
              <Text style={{ fontWeight: '700', fontSize: 14, color: tokens.color.ink }}>
                {c.name}
              </Text>
              <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                {c.taken ? `Taken by ${c.markedBy ?? '—'}` : `${c.total} students · not taken yet`}
              </Text>
            </View>
            {c.taken ? (
              <Pill tone="green">{`✓ ${c.present}/${c.total} present`}</Pill>
            ) : (
              <Pill tone="amber">Pending</Pill>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
            {c.taken ? (
              <Pressable
                onPress={() => confirmRetake(c)}
                testID={`retake-${c.classSectionId}`}
                style={{ flex: 1, backgroundColor: tokens.color.red50, borderRadius: 13, padding: 10 }}
              >
                <Text style={{ color: tokens.color.red, fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
                  Retake
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => goTake(c)}
                testID={`take-${c.classSectionId}`}
                style={{ flex: 1, backgroundColor: tokens.color.indigo, borderRadius: 13, padding: 11 }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
                  Take attendance now
                </Text>
              </Pressable>
            )}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
