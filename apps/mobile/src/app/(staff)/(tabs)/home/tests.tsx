import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { Exam, ExamList, MyClassSection, Subject } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { DEFAULT_SCHEDULE_TIME, isValidMaxMarks, toScheduledAtISO } from '@/lib/exams';
import { Card, Empty, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button } from '@/components/Button';
import { DateField, SelectField, TextField } from '@/components/Field';
import { addDays, classOptions, onlyOwnSubject, subjectOptions, useMySubjectNames } from '@/lib/subject-options';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { fmtDateTime, fmtWeekdayDay } from '@/lib/dates';

/** Quarter-hours across a school day, labelled the way people say them. */
const TIME_OPTIONS = Array.from({ length: (17 - 7) * 4 + 1 }, (_, i) => {
  const h = 7 + Math.floor(i / 4);
  const m = (i % 4) * 15;
  const id = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const h12 = ((h + 11) % 12) + 1;
  return { id, label: `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` };
});

export default function Tests() {
  const tokens = useTokens();
  // The same 13/600 label `Field` draws, for the groups that are not a text box.
  const labelStyle = { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, color: tokens.color.ink2 };
  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [classSectionId, setClassSectionId] = useState('');

  const [examList, setExamList] = useState<ExamList | null>(null);
  const [examsError, setExamsError] = useState<string | null>(null);
  const [examsLoading, setExamsLoading] = useState(false);

  const [subjectId, setSubjectId] = useState('');
  const mySubjects = useMySubjectNames();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(DEFAULT_SCHEDULE_TIME);
  const [syllabus, setSyllabus] = useState('');
  const [maxMarksRaw, setMaxMarksRaw] = useState('100');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(false);
  // THE RESULT ROOM'S CLOCK (second edition). The admin sets a result day
  // per report window; the web renders it where marks are typed, so the app
  // does too. Best-effort — a countdown must never fail the screen.
  const [resultDays, setResultDays] = useState<{ id: string; name: string; resultDay: string }[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .request<{ id: string; name: string; resultDay: string }[]>('/manage/exams/result-days')
      .then((rows) => {
        if (alive) setResultDays(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        /* a countdown must never surface an error */
      });
    return () => {
      alive = false;
    };
  }, []);
  const nextDue = resultDays.filter((w) => Date.parse(w.resultDay) >= Date.now() - 86_400_000)[0] ?? null;

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
  // One class? It is the class. One subject of their own? Pre-pick it.
  useEffect(() => {
    if (!classSectionId && classes && classes.length === 1) selectClass(classes[0].classSectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes]);
  useEffect(() => {
    if (!subjectId && subjects) {
      const only = onlyOwnSubject(subjects, mySubjects);
      if (only) setSubjectId(only);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, mySubjects]);


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
      setSubjectId(onlyOwnSubject(subjects ?? [], mySubjects) ?? '');
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
      style={({ pressed }) => ({
        minHeight: 72,
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginHorizontal: -16,
        justifyContent: 'center',
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        opacity: pressed ? 0.8 : 1,
      })}
      accessibilityRole="button"
      >
      <Text style={{ fontWeight: '600', fontSize: 16, color: tokens.color.ink }}>{exam.title}</Text>
      <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>
        {subjectLabel(exam.subjectId)} · {fmtDateTime(exam.scheduledAt)} · out of{' '}
        {exam.maxMarks}
      </Text>
      {exam.syllabus && (
        <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }} numberOfLines={1}>
          {exam.syllabus}
        </Text>
      )}
    </Pressable>
  );

  return (
    <Screen>
      <SectionTitle title="Tests" />
      {nextDue && <ResultDayCard window={nextDue} />}
      <Text style={{ fontSize: 14, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
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
          <SelectField
            label="Class"
            testID="test-class"
            optionTestID={(id) => `class-${id}`}
            placeholder="Choose a class"
            value={classSectionId || null}
            options={classOptions(classes)}
            onChange={selectClass}
          />
        </Card>
      )}

      {/* Choose-first (empty kind "choose", v2 2026-10-08): until a class is
          picked the form is hidden, and the page said so with 80% blank. */}
      {classes && classes.length > 0 && !classSectionId && (
        <Empty kind="choose" icon="results" title="Choose a class above">
          The form opens for that class — you can schedule a test for one class at a time.
        </Empty>
      )}

      {classSectionId && (
        <Card style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink }}>Schedule a test</Text>
            <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>
              Students and guardians are emailed as soon as you save.
            </Text>
          </View>

          {subjectsError && <Text style={{ color: tokens.color.red, fontSize: 13 }}>{subjectsError}</Text>}
          <SelectField
            label="Subject"
            testID="test-subject"
            optionTestID={(id) => `subject-${id}`}
            placeholder="Choose a subject"
            value={subjectId || null}
            options={subjectOptions(subjects ?? [], mySubjects)}
            onChange={setSubjectId}
          />

          <TextField
            label="Title"
            testID="test-title"
            value={title}
            onChangeText={setTitle}
            placeholder="Unit test 1"
          />

          {/* Date on a calendar with its weekday; time from a list of
              quarter-hours — no more tapping ‹ › once per day or per 15 min. */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 3 }}>
              <DateField
                label="Date"
                testID="test-date"
                value={date}
                minDate={todayISO()}
                onChange={setDate}
              />
            </View>
            <View style={{ flex: 2 }}>
              <SelectField
                label="Time"
                testID="test-time"
                sheetTitle="Start time"
                searchable={false}
                value={time}
                options={TIME_OPTIONS}
                onChange={setTime}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -2 }}>
            {[
              { label: 'Tomorrow', iso: addDays(todayISO(), 1) },
              { label: 'In a week', iso: addDays(todayISO(), 7) },
              { label: 'In two weeks', iso: addDays(todayISO(), 14) },
            ].map((q) => (
              <Pressable
                key={q.label}
                testID={`test-date-quick-${q.label.replace(/\s+/g, '-').toLowerCase()}`}
                accessibilityRole="button"
                accessibilityState={{ selected: date === q.iso }}
                onPress={() => setDate(q.iso)}
                style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: date === q.iso ? tokens.color.indigo : tokens.color.indigo50 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: date === q.iso ? tokens.color.onBrand : tokens.color.indigo }}>{q.label}</Text>
              </Pressable>
            ))}
          </View>

          <View>
            <TextField
              label="Max marks"
              testID="test-max-marks"
              value={maxMarksRaw}
              onChangeText={(v) => setMaxMarksRaw(v.replace(/\D/g, ''))}
              keyboardType="numeric"
            />
            {maxMarksRaw.length > 0 && !maxMarksOk && (
              <Text testID="max-marks-error" style={{ color: tokens.color.red, fontSize: 13, marginTop: 4 }}>
                Max marks must be a whole number greater than 0.
              </Text>
            )}
          </View>

          <TextField
            label="Syllabus"
            optional
            testID="test-syllabus"
            value={syllabus}
            onChangeText={setSyllabus}
            multiline
            placeholder="Chapters 1–4, plus the worksheet from last week."
          />

          {scheduleError && (
            <Text testID="schedule-error" style={{ color: tokens.color.red, fontSize: 13 }}>
              {scheduleError}
            </Text>
          )}

          <Button
            testID="schedule-submit"
            block
            disabled={!canSchedule}
            busy={scheduling}
            label={scheduling ? 'Scheduling…' : 'Schedule test'}
            onPress={() => void schedule()}
          />

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
          <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink }}>Scheduled tests</Text>
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

/** Whole days from today to an ISO date (UTC-safe, calendar boundaries). */
function daysTo(iso: string): number {
  const t = new Date(iso);
  const target = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const n = new Date();
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** "Term 1 marks due · Fri 26 Sep · 9 days" — the deadline, where the marks are typed. */
function ResultDayCard({ window }: { window: { id: string; name: string; resultDay: string } }) {
  const tokens = useTokens();
  const d = daysTo(window.resultDay);
  const when = fmtWeekdayDay(window.resultDay.slice(0, 10));
  const tone = d < 0 ? 'red' : d <= 3 ? 'amber' : 'indigo';
  const word = d < 0 ? `${-d} day${d === -1 ? '' : 's'} over` : d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`;
  return (
    <Card testID="result-day" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: d <= 3 ? tokens.color.amber : tokens.color.line }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: tokens.color.sub }}>Marks due</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: tokens.color.ink, marginTop: 1 }} numberOfLines={1}>
          {window.name} · {when}
        </Text>
      </View>
      <Pill tone={tone}>{word}</Pill>
    </Card>
  );
}
