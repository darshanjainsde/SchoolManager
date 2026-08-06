import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Exam, ExamList, MyClassSection, Subject } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';
import { DEFAULT_SCHEDULE_TIME, isValidMaxMarks, shiftTime, toScheduledAtISO } from '@/lib/exams';
import { Card, Screen, SectionTitle, Toast } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font, type ColorPalette } from '@/theme/tokens';

function chipStyle(tokens: { color: ColorPalette }, on: boolean) {
  return {
    borderWidth: 1.5,
    borderColor: on ? tokens.color.indigo : tokens.color.line,
    backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 13,
  };
}

export default function Tests() {
  const tokens = useTokens();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
  };
  const labelStyle = { fontSize: 11.5, fontWeight: '700' as const, color: tokens.color.sub };
  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [classSectionId, setClassSectionId] = useState('');

  const [examList, setExamList] = useState<ExamList | null>(null);
  const [examsError, setExamsError] = useState<string | null>(null);
  const [examsLoading, setExamsLoading] = useState(false);

  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(DEFAULT_SCHEDULE_TIME);
  const [syllabus, setSyllabus] = useState('');
  const [maxMarksRaw, setMaxMarksRaw] = useState('100');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setClassesError(null);
      api
        .request<MyClassSection[]>('/manage/attendance/my-classes')
        .then((data) => {
          if (!cancelled) setClasses(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setClassesError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setSubjectsError(null);
      api
        .request<Subject[]>('/manage/subjects')
        .then((data) => {
          if (!cancelled) setSubjects(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setSubjectsError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const fetchExams = useCallback((id: string) => {
    if (!id) {
      setExamList(null);
      return;
    }
    setExamsLoading(true);
    setExamsError(null);
    api
      .request<ExamList>(`/manage/exams?classSectionId=${encodeURIComponent(id)}`)
      .then((data) => setExamList(data))
      .catch((e: unknown) => setExamsError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => setExamsLoading(false));
  }, []);

  useEffect(() => {
    fetchExams(classSectionId);
  }, [classSectionId, fetchExams]);

  const selectClass = (id: string) => {
    setClassSectionId(id);
    setScheduled(false);
    setScheduleError(null);
  };

  const maxMarksOk = isValidMaxMarks(maxMarksRaw);
  const canSchedule =
    !!classSectionId && !!subjectId && title.trim().length > 0 && maxMarksOk && !scheduling;

  const schedule = async () => {
    if (!canSchedule) return;
    setScheduling(true);
    setScheduleError(null);
    setScheduled(false);
    try {
      await api.request<Exam>('/manage/exams', {
        method: 'POST',
        body: {
          classSectionId,
          subjectId,
          title: title.trim(),
          scheduledAt: toScheduledAtISO(date, time),
          syllabus: syllabus.trim() || undefined,
          maxMarks: Number(maxMarksRaw),
        },
      });
      setSubjectId('');
      setTitle('');
      setDate(todayISO());
      setTime(DEFAULT_SCHEDULE_TIME);
      setSyllabus('');
      setMaxMarksRaw('100');
      setScheduled(true);
      fetchExams(classSectionId);
    } catch (e) {
      setScheduleError(e instanceof ApiError ? e.message : 'Could not schedule — try again.');
    } finally {
      setScheduling(false);
    }
  };

  const subjectLabel = (id: string) => {
    const s = (subjects ?? []).find((x) => x.id === id);
    return s ? `${s.code} — ${s.name}` : '—';
  };

  const upcoming = examList?.upcoming ?? [];
  const past = examList?.past ?? [];

  const openResults = (exam: Exam) => {
    router.push(`/(staff)/(tabs)/home/results/${exam.id}?classSectionId=${encodeURIComponent(classSectionId)}`);
  };

  const renderExamRow = (exam: Exam) => (
    <Pressable
      key={exam.id}
      testID={`exam-${exam.id}`}
      onPress={() => openResults(exam)}
      style={{
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
      }}
    >
      <Text style={{ fontFamily: font.serif, fontWeight: '700', fontSize: 14, color: tokens.color.ink }}>{exam.title}</Text>
      <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
        {subjectLabel(exam.subjectId)} · {new Date(exam.scheduledAt).toLocaleString()} · out of{' '}
        {exam.maxMarks}
      </Text>
      {exam.syllabus && (
        <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 2 }} numberOfLines={1}>
          {exam.syllabus}
        </Text>
      )}
    </Pressable>
  );

  return (
    <Screen>
      <SectionTitle title="Tests" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Schedule a test and the class&apos;s students and guardians get an email straight away.
      </Text>

      {classesError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{classesError}</Text>
        </Card>
      )}
      {classes === null && !classesError && (
        <LoadingRows label="Loading your classes…" rows={5} />
      )}
      {classes?.length === 0 && !classesError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You have no classes assigned yet.</Text>
        </Card>
      )}

      {classes && classes.length > 0 && (
        <Card>
          <Text style={{ ...labelStyle, marginBottom: 8 }}>Class</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {classes.map((c) => {
              const on = classSectionId === c.classSectionId;
              return (
                <Pressable
                  key={c.classSectionId}
                  testID={`class-${c.classSectionId}`}
                  onPress={() => selectClass(c.classSectionId)}
                  style={chipStyle(tokens, on)}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? tokens.color.indigo : tokens.color.sub }}>
                    {on ? `✓ ${c.name}` : c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {classSectionId && (
        <Card style={{ gap: 10 }}>
          <View>
            <Text style={{ fontFamily: font.serif, fontSize: 16, fontWeight: '700', color: tokens.color.ink }}>Schedule a test</Text>
            <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 2 }}>
              Students and guardians are emailed as soon as you save.
            </Text>
          </View>

          {subjectsError && <Text style={{ color: tokens.color.red, fontSize: 12.5 }}>{subjectsError}</Text>}
          <View>
            <Text style={labelStyle}>Subject</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 }}>
              {(subjects ?? []).map((s) => {
                const on = subjectId === s.id;
                return (
                  <Pressable key={s.id} testID={`subject-${s.id}`} onPress={() => setSubjectId(s.id)} style={chipStyle(tokens, on)}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? tokens.color.indigo : tokens.color.sub }}>
                      {on ? `✓ ${s.code}` : s.code}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View>
            <Text style={labelStyle}>Title</Text>
            <TextInput
              testID="test-title"
              value={title}
              onChangeText={setTitle}
              placeholder="Unit test 1"
              placeholderTextColor={tokens.color.sub}
              style={[inputStyle, { marginTop: 6 }]}
            />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={labelStyle}>Date</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable testID="test-date-prev" onPress={() => setDate((d) => shiftISO(d, -1))}>
                <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>‹</Text>
              </Pressable>
              <Text testID="test-date-value" style={{ fontSize: 12.5, color: tokens.color.ink, minWidth: 84, textAlign: 'center' }}>
                {date}
              </Text>
              <Pressable testID="test-date-next" onPress={() => setDate((d) => shiftISO(d, 1))}>
                <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>›</Text>
              </Pressable>
            </View>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={labelStyle}>Time</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable testID="test-time-prev" onPress={() => setTime((t) => shiftTime(t, -15))}>
                <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>‹</Text>
              </Pressable>
              <Text testID="test-time-value" style={{ fontSize: 12.5, color: tokens.color.ink, minWidth: 60, textAlign: 'center' }}>
                {time}
              </Text>
              <Pressable testID="test-time-next" onPress={() => setTime((t) => shiftTime(t, 15))}>
                <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>›</Text>
              </Pressable>
            </View>
          </View>

          <View>
            <Text style={labelStyle}>Max marks</Text>
            <TextInput
              testID="test-max-marks"
              value={maxMarksRaw}
              onChangeText={(v) => setMaxMarksRaw(v.replace(/\D/g, ''))}
              keyboardType="numeric"
              style={[inputStyle, { marginTop: 6 }]}
            />
            {maxMarksRaw.length > 0 && !maxMarksOk && (
              <Text testID="max-marks-error" style={{ color: tokens.color.red, fontSize: 11.5, marginTop: 4 }}>
                Max marks must be a whole number greater than 0.
              </Text>
            )}
          </View>

          <View>
            <Text style={labelStyle}>Syllabus (optional)</Text>
            <TextInput
              testID="test-syllabus"
              value={syllabus}
              onChangeText={setSyllabus}
              multiline
              placeholder="Chapters 1–4, plus the worksheet from last week."
              placeholderTextColor={tokens.color.sub}
              style={[inputStyle, { marginTop: 6, minHeight: 64, textAlignVertical: 'top' }]}
            />
          </View>

          {scheduleError && (
            <Text testID="schedule-error" style={{ color: tokens.color.red, fontSize: 12.5 }}>
              {scheduleError}
            </Text>
          )}

          <Pressable
            testID="schedule-submit"
            disabled={!canSchedule}
            onPress={() => void schedule()}
            style={{
              backgroundColor: tokens.color.indigo,
              borderRadius: 13,
              padding: 12,
              alignSelf: 'flex-start',
              paddingHorizontal: 18,
              opacity: canSchedule ? 1 : 0.6,
            }}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 13 }}>
              {scheduling ? 'Scheduling…' : 'Schedule test'}
            </Text>
          </Pressable>

          {scheduled && (
            <Toast
              kind="success"
              testID="schedule-success"
              message="Test scheduled — the class is being notified by email."
            />
          )}
        </Card>
      )}

      {classSectionId && (
        <Card>
          <Text style={{ fontFamily: font.serif, fontSize: 16, fontWeight: '700', color: tokens.color.ink }}>Scheduled tests</Text>
          {examsLoading && <LoadingRows label="Loading tests…" rows={3} bare />}
          {examsError && (
            <Text testID="exams-error" style={{ color: tokens.color.red, marginTop: 6 }}>
              {examsError}
            </Text>
          )}
          {!examsLoading && !examsError && upcoming.length === 0 && past.length === 0 && (
            <Text style={{ color: tokens.color.sub, marginTop: 6 }}>No tests for this class yet.</Text>
          )}
          {upcoming.length > 0 && (
            <View style={{ marginTop: 10 }}>
              <Text style={labelStyle}>Upcoming</Text>
              {upcoming.map((e) => renderExamRow(e))}
            </View>
          )}
          {past.length > 0 && (
            <View style={{ marginTop: 10 }}>
              <Text style={labelStyle}>Past</Text>
              {past.map((e) => renderExamRow(e))}
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}
