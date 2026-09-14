'use client';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, GraduationCap, ClipboardList, Percent } from 'lucide-react';
import type {
  Announcement,
  AttendanceStatusValue,
  AttendanceSummary,
  PortalHome,
  Profile,
  PublishedResult,
  StudentDiaryResult,
  TimetableSlot,
  UpcomingExam,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Constants ─────────────────────────────────────────────────────────────────

const ATTENDANCE_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
};

const ATTENDANCE_TONES: Record<AttendanceStatusValue, 'good' | 'warn' | 'bad'> = {
  PRESENT: 'good',
  ABSENT: 'bad',
  LATE: 'warn',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JS getDay() → 1-7 (Mon=1, Sun=7) */
function todayDayOfWeek(): number {
  return new Date().getDay() || 7;
}

/** Minutes since midnight for a "HH:MM" time string. */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since midnight on the device's own clock. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** "Saturday, 2 August" — the dateline that opens the page, written out. */
function datelineLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Where a period sits relative to the clock. Times can arrive empty from the
 * API (`period.startTime`/`endTime` are optional in the timetable UI), in
 * which case `minutesOfDay` yields NaN, every comparison is false, and the row
 * falls through to `future` — an un-timed period is never claimed to be over.
 */
function railState(startTime: string, endTime: string, now: number): 'past' | 'now' | 'future' {
  if (now >= minutesOfDay(endTime)) return 'past';
  if (now >= minutesOfDay(startTime)) return 'now';
  return 'future';
}

/** `YYYY-MM` for the given local date — the key `/me/attendance` expects. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` for the given local date. */
function dayKey(d: Date): string {
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Whole days from today until `iso`, counted on calendar-day boundaries so a
 * test at 09:00 tomorrow reads "in 1 day", not "in 0 days".
 */
function daysUntil(iso: string): number {
  const target = new Date(iso);
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86_400_000);
}

function daysUntilLabel(iso: string): string {
  const d = daysUntil(iso);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
}

/** A compact KPI tile, optionally linking through to the full page. */
function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  href,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
  href?: string;
}) {
  const inner = (
    <>
      <span className="lab">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span className="n">{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="sk-kpi" data-tone={tone}>
      {inner}
    </Link>
  ) : (
    <div className="sk-kpi" data-tone={tone}>
      {inner}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const thisMonth = monthKey(new Date());
  const queryClient = useQueryClient();

  /**
   * One request for the whole home screen.
   *
   * This page used to open with SEVEN — profile, timetable, announcements,
   * attendance, exams, results, diary — fired together the moment it mounted.
   * On the API each of those resolved the student in one tenant transaction
   * and fetched its data in another, so opening the portal cost about fourteen,
   * and a transaction holds a pooled connection for its whole life. This is the
   * highest-traffic screen in the product: every family, every day.
   *
   * GET /me/home composes the same seven service methods — it IS those methods,
   * so nothing here can drift from what the individual routes answer — and the
   * five the portal service owns now share a single transaction.
   *
   * The answer is written back into the seven original cache keys. They are the
   * keys the sub-pages use (/portal/timetable, /portal/results, and the rest),
   * so walking into one of those from here is now free rather than another
   * request. Seeding from inside queryFn rather than an effect is deliberate:
   * it happens once per fetch, with the data in hand, and cannot race a render.
   */
  const homeQuery = useQuery({
    queryKey: ['portal-home', thisMonth],
    queryFn: async () => {
      const home = await api.get<PortalHome>(`/me/home?month=${thisMonth}`);
      queryClient.setQueryData(['portal-profile'], home.profile);
      queryClient.setQueryData(['portal-timetable'], home.timetable);
      queryClient.setQueryData(['portal-announcements'], home.announcements);
      queryClient.setQueryData(['portal-attendance', thisMonth], home.attendance);
      queryClient.setQueryData(['portal-exams'], home.exams);
      queryClient.setQueryData(['portal-results'], home.results);
      queryClient.setQueryData(['portal-diary'], home.diary);
      return home;
    },
    enabled: !!host,
    staleTime: 60_000,
  });

  const home = homeQuery.data;
  // Every section arrives together now, so they share one loading and one error
  // state — which is also the honest reading of what is happening.
  const loading = homeQuery.isLoading;
  const loadError = homeQuery.error;

  const unsignedCount = home?.diary?.unsignedCount ?? 0;

  const profile = home?.profile;
  const todaySlots = (home?.timetable ?? [])
    .filter((s) => s.dayOfWeek === todayDayOfWeek())
    .sort((a, b) => a.period.order - b.period.order);
  const latestAnnouncements = (home?.announcements ?? []).slice(0, 3);

  // `/me/attendance` returns only the days that were actually marked, so a
  // missing entry means "not marked yet today" — not "absent".
  const attendance = home?.attendance;
  const todayStatus = attendance?.days.find((d) => d.date === dayKey(new Date()))?.status;
  const attendanceMarked = attendance
    ? attendance.present + attendance.absent + attendance.late
    : 0;

  // Both lists arrive pre-ordered by the API: exams ascending (soonest first),
  // results descending (most recent first).
  const nextExam = home?.exams?.[0];
  const latestResult = home?.results?.[0];

  // ── "Right now" hero state, derived from today's timetable + attendance ──
  const nowMin = nowMinutes();
  const currentSlot = todaySlots.find(
    (s) => nowMin >= minutesOfDay(s.period.startTime) && nowMin < minutesOfDay(s.period.endTime),
  );
  const nextSlot = todaySlots.find((s) => minutesOfDay(s.period.startTime) > nowMin);
  const hasSchoolToday = todaySlots.length > 0;
  const heroElapsed = currentSlot ? nowMin - minutesOfDay(currentSlot.period.startTime) : 0;
  const heroTotal = currentSlot
    ? minutesOfDay(currentSlot.period.endTime) - minutesOfDay(currentSlot.period.startTime)
    : 0;
  const heroPct = heroTotal > 0 ? Math.min(100, Math.max(0, Math.round((heroElapsed / heroTotal) * 100))) : 0;
  const statusChipText =
    todayStatus === 'PRESENT'
      ? '✓ Present today'
      : todayStatus === 'LATE'
        ? '⏱ Late today'
        : todayStatus === 'ABSENT'
          ? '✕ Absent today'
          : null;
  const attendanceGlyph =
    todayStatus === 'PRESENT' ? '✓' : todayStatus === 'LATE' ? '⏱' : todayStatus === 'ABSENT' ? '✕' : '—';

  /** Loading/error/empty all collapse to one short string per tile. */
  // Every tile is fed by the one request now, so they share its state rather
  // than each being handed a query of its own.
  const tileText = (value: string | undefined, empty: string): string => {
    if (loading) return '…';
    if (loadError) return 'Unavailable';
    return value ?? empty;
  };

  return (
    <div className="sk-anim" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        {/* The dateline. A diary page starts with its date, so the portal
            does too — serif italic, the same margin-note voice the empty
            states use, with the day itself tagged in amber because "which
            day am I looking at" is the question every other card answers
            relative to. */}
        <div className="sk-dateline">
          <span className="dow">{datelineLabel(new Date())}</span>
          <span className="sk-todaytag">TODAY</span>
        </div>
        <div className="sk-greet" style={{ marginTop: 4 }}>
          {profile ? (
            <>
              Hi, {profile.firstName} <span className="wave">👋</span>
            </>
          ) : (
            'Welcome back'
          )}
        </div>
        {profile?.className && <div className="sk-sub">{profile.className} · Roll {profile.rollNo ?? '—'}</div>}
      </header>

      {/* THE SIGNATURE ASK. Above the hero because it is the only thing on
          this page that is owed BY the reader — everything below reports what
          happened; this one waits on them. It renders only when something is
          actually outstanding, so it never becomes furniture. Twin of the
          app's `diary-banner`. */}
      {unsignedCount > 0 && (
        <Link href="/portal/diary" className="sk-signbanner" data-testid="diary-banner">
          <span className="ic" aria-hidden="true">
            📔
          </span>
          <span className="tx">
            <span className="t">
              {unsignedCount === 1
                ? 'A diary remark to sign'
                : `${unsignedCount} diary remarks to sign`}
            </span>
            <span className="d">Open the diary to read and sign.</span>
          </span>
          <span className="sk-pill" data-tone="bad">
            Sign
          </span>
        </Link>
      )}

      {/* State-aware "right now" hero — mirrors the mobile StudentHero. Shown
          once the timetable resolves; the schedule card below surfaces any error. */}
      {!loadError &&
        (loading ? (
          <div className="sk-hero">
            <div className="eyebrow">Today</div>
            <h2>Loading your day…</h2>
          </div>
        ) : !hasSchoolToday ? (
          <div className="sk-hero" data-variant="holiday">
            <div className="eyebrow">🌴 No school today</div>
            <h2>Enjoy the day off</h2>
            <div className="meta">No classes are scheduled for today.</div>
          </div>
        ) : currentSlot ? (
          <div className="sk-hero">
            <div className="eyebrow">
              <span className="live" /> In class now
            </div>
            <h2>{currentSlot.subject.name}</h2>
            <div className="meta">
              {currentSlot.teacher.firstName} {currentSlot.teacher.lastName} · {currentSlot.period.label} · ends{' '}
              {currentSlot.period.endTime}
            </div>
            <div className="bar">
              <i style={{ width: `${heroPct}%` }} />
            </div>
            <div className="barmeta">
              <span>Started {currentSlot.period.startTime}</span>
              <span>{Math.max(0, heroTotal - heroElapsed)} min left</span>
            </div>
            {statusChipText && <span className="chip">{statusChipText}</span>}
          </div>
        ) : !nextSlot ? (
          <div className="sk-hero" data-variant="done">
            <div className="eyebrow">🎒 That&apos;s a wrap</div>
            <h2>School&apos;s done for today</h2>
            <div className="meta">
              {todaySlots.length} {todaySlots.length === 1 ? 'class' : 'classes'} today
            </div>
            <div className="cells">
              <div className="cell">
                <div className="cn">{todaySlots.length}</div>
                <div className="cl">classes today</div>
              </div>
              <div className="cell">
                <div className="cn">{attendanceGlyph}</div>
                <div className="cl">attendance</div>
              </div>
              <div className="cell">
                <div className="cn">{attendanceMarked > 0 ? `${attendance?.percent}%` : '—'}</div>
                <div className="cl">this month</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="sk-hero">
            <div className="eyebrow">Up next</div>
            <h2>{nextSlot.subject.name}</h2>
            <div className="meta">
              {nextSlot.teacher.firstName} {nextSlot.teacher.lastName} · at {nextSlot.period.startTime}
            </div>
            {statusChipText && <span className="chip">{statusChipText}</span>}
          </div>
        ))}

      {/* Upcoming-test reminder — the thing a student should never miss */}
      {nextExam && (
        <div className="sk-remind">
          <span className="ic">🔔</span>
          <div style={{ flex: 1 }}>
            <b>
              {nextExam.subjectName} · {nextExam.title} — {daysUntilLabel(nextExam.scheduledAt).toLowerCase()}
            </b>
            <p>
              {formatDate(nextExam.scheduledAt)}
              {nextExam.syllabus ? ` · ${nextExam.syllabus}` : ''} · out of {nextExam.maxMarks}
            </p>
          </div>
        </div>
      )}

      {/* At-a-glance KPIs */}
      <div className="sk-kpis">
        <StatTile
          icon={CalendarCheck}
          label="Today"
          href="/portal/attendance"
          tone={todayStatus ? ATTENDANCE_TONES[todayStatus] : undefined}
          value={tileText(todayStatus ? ATTENDANCE_LABELS[todayStatus] : undefined, 'Not marked')}
          hint="Attendance"
        />
        <StatTile
          icon={Percent}
          label="This month"
          href="/portal/attendance"
          tone={attendance && attendanceMarked > 0 && attendance.percent < 75 ? 'warn' : undefined}
          value={tileText(attendanceMarked > 0 ? `${attendance?.percent}%` : undefined, 'No records')}
          hint={attendanceMarked > 0 ? `${attendance?.present} of ${attendanceMarked} days present` : 'Nothing recorded yet'}
        />
        <StatTile
          icon={ClipboardList}
          label="Next test"
          value={tileText(nextExam?.subjectName, 'None scheduled')}
          hint={nextExam ? `${nextExam.title} — ${daysUntilLabel(nextExam.scheduledAt).toLowerCase()}` : 'No upcoming tests'}
        />
        <StatTile
          icon={GraduationCap}
          label="Latest result"
          href="/portal/results"
          tone={
            latestResult
              ? latestResult.marks < latestResult.classAverage
                ? 'bad'
                : 'good'
              : undefined
          }
          value={tileText(latestResult ? `${latestResult.marks}/${latestResult.maxMarks}` : undefined,
            'None yet',
          )}
          hint={latestResult ? `${latestResult.subjectName} · class avg ${latestResult.classAverage}` : 'None published yet'}
        />
      </div>

      <div className="sk-grid2">
        {/* Today's timetable, as the pitch's ruled rail: the time in the
            margin column, a red margin rule down the left, the entry written
            to the right of it. A list of periods drawn this way reads as a
            page out of an exercise book rather than as a table — which is the
            whole argument of the redesign. */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Today&apos;s schedule</h3>
          </div>
          <div className="sk-card-b">
            {loading && <p className="sk-state">Loading…</p>}
            {loadError && <p className="sk-state err">{(loadError as Error).message}</p>}
            {!loading && !loadError && todaySlots.length === 0 && (
              <p className="sk-state">No classes scheduled for today.</p>
            )}
            {todaySlots.length > 0 && (
              <div>
                {todaySlots.map((slot) => {
                  const state = railState(slot.period.startTime, slot.period.endTime, nowMin);
                  return (
                    <div className="sk-rowln" data-state={state} key={slot.id}>
                      <span className="time">
                        {slot.period.startTime}
                        <br />
                        {slot.period.endTime}
                      </span>
                      {/* THE MARGIN RULE — decorative, so it is hidden from
                          assistive tech; the times already say where the row
                          sits in the day. */}
                      <span className="sk-rail-ml" aria-hidden="true" />
                      <div className="bd">
                        <div className="sub">{slot.subject.name}</div>
                        <div className="tch">
                          {slot.teacher.firstName} {slot.teacher.lastName} · {slot.period.label}
                        </div>
                      </div>
                      <span className="st">
                        {state === 'past' ? '✓' : state === 'now' ? 'now' : slot.id === nextSlot?.id ? 'next' : ''}
                      </span>
                      {/* THE INK LINE. Grows under the period happening right
                          now, to the fraction of it that has elapsed — the same
                          number the hero states in words above. It is drawn to
                          its real width, so switching the animation off (as
                          reduced motion does) still leaves a true bar. */}
                      {state === 'now' && (
                        <span
                          className="sk-liveink sk-inkline"
                          style={{ width: `${heroPct}%` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Latest announcements */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Latest announcements</h3>
          </div>
          <div className="sk-card-b">
            {loading && <p className="sk-state">Loading…</p>}
            {loadError && <p className="sk-state err">{(loadError as Error).message}</p>}
            {!loading && !loadError && latestAnnouncements.length === 0 && (
              <p className="sk-state">No announcements yet.</p>
            )}
            {/* Announcements arrive as pinned slips, not as list rows: THE PIN
                (`sk-pinin`) drops each one in slightly askew and settles it,
                which is how a noticeboard says "this went up recently".
                Staggered so three slips read as three separate pieces of
                paper rather than as one block appearing. */}
            {latestAnnouncements.length > 0 && (
              <div>
                {latestAnnouncements.map((ann, i) => (
                  <div
                    className="sk-notice sk-pinin sk-in"
                    key={ann.id}
                    style={{ animationDelay: `${i * 0.09}s` }}
                  >
                    <div className="nt">{ann.title}</div>
                    <div className="nd">
                      {ann.classSectionId ? 'Your class' : 'Whole school'} · {formatDate(ann.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
