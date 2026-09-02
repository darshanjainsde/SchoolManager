'use client';
import Link from 'next/link';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import type { MorningBell } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { BellCard } from './bell-card';

// ── Types ────────────────────────────────────────────────────────────────────

interface AcademicYear {
  id: string;
  isCurrent?: boolean;
}
interface Period {
  id: string;
}
interface Subject {
  id: string;
}
interface ClassRow {
  id: string;
  _count?: { students: number };
}
interface Teacher {
  id: string;
}
interface Student {
  id: string;
}


interface SetupStep {
  key: string;
  label: string;
  helper: string;
  href: string;
  done: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Loading -> "…", errored -> "—" (never crashes the dashboard), else the count. */
function kpiValue(query: UseQueryResult<unknown, unknown>, count: number): string {
  if (query.isLoading) return '…';
  if (query.isError) return '—';
  return String(count);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const yearsQuery = useQuery({
    queryKey: ['dash-years'],
    queryFn: () => api.get<AcademicYear[]>('/manage/years'),
    enabled: !!host,
    staleTime: 60_000,
  });
  const periodsQuery = useQuery({
    queryKey: ['dash-periods'],
    queryFn: () => api.get<Period[]>('/manage/periods'),
    enabled: !!host,
    staleTime: 60_000,
  });
  const subjectsQuery = useQuery({
    queryKey: ['dash-subjects'],
    queryFn: () => api.get<Subject[]>('/manage/subjects'),
    enabled: !!host,
    staleTime: 60_000,
  });
  const classesQuery = useQuery({
    queryKey: ['dash-classes'],
    queryFn: () => api.get<ClassRow[]>('/manage/classes'),
    enabled: !!host,
    staleTime: 60_000,
  });
  const teachersQuery = useQuery({
    queryKey: ['dash-teachers'],
    queryFn: () => api.get<Teacher[]>('/manage/teachers'),
    enabled: !!host,
    staleTime: 60_000,
  });
  const studentsQuery = useQuery({
    queryKey: ['dash-students'],
    queryFn: () => api.get<Student[] | { items: Student[] }>('/manage/students'),
    enabled: !!host,
    staleTime: 60_000,
  });
  const bellQuery = useQuery({
    queryKey: ['bell', host], enabled: !!host,
    queryFn: () => api.get<MorningBell>('/manage/bell'),
    // The Bell describes a morning; re-ring it if the tab stays open.
    refetchInterval: 5 * 60_000,
  });


  const years = yearsQuery.data ?? [];
  const periods = periodsQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const classes = classesQuery.data ?? [];
  const teachers = teachersQuery.data ?? [];
  const studentsRaw = studentsQuery.data;
  const students = Array.isArray(studentsRaw) ? studentsRaw : (studentsRaw?.items ?? []);

  // A resource that errors resolves to an empty array above, so a step just
  // reads as "not done yet" rather than crashing the page.
  const steps: SetupStep[] = [
    {
      key: 'year',
      label: 'Set your academic year',
      helper: 'Define the current school year so records have somewhere to live.',
      href: '/app/settings',
      // Any year is enough, but a year marked "current" satisfies it too.
      done: years.some((y) => y.isCurrent) || years.length > 0,
    },
    {
      key: 'periods',
      label: 'Add class periods (bell times)',
      helper: 'Set up the daily schedule blocks your classes will run in.',
      href: '/app/settings',
      done: periods.length > 0,
    },
    {
      key: 'subjects',
      label: 'Add grades & subjects',
      helper: 'Create the grade levels and subjects your school teaches.',
      href: '/app/classes/structure',
      done: subjects.length > 0,
    },
    {
      key: 'classes',
      label: 'Create classes',
      helper: 'Set up class sections for each grade.',
      href: '/app/classes',
      done: classes.length > 0,
    },
    {
      key: 'teachers',
      label: 'Add teachers',
      helper: 'Invite teachers so they can take attendance and record results.',
      href: '/app/teachers',
      done: teachers.length > 0,
    },
    {
      key: 'students',
      label: 'Add students',
      helper: 'Enroll students and assign them to their classes.',
      href: '/app/students',
      done: students.length > 0,
    },
    {
      key: 'timetable',
      label: 'Build the timetable',
      helper: 'Assign subjects and teachers to periods for each class.',
      href: '/app/timetable',
      // No endpoint to check timetable entries directly — once classes exist
      // the timetable is buildable, so we treat that as this step's signal.
      done: classes.length > 0,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const anySetupLoading = [
    yearsQuery,
    periodsQuery,
    subjectsQuery,
    classesQuery,
    teachersQuery,
    studentsQuery,
  ].some((q) => q.isLoading);

  return (
    // NOTE ON THE VIEW FADE: the pitch's `wfade` — "this view just arrived" —
    // is already on this page, applied by the admin layout, which puts
    // `.sk-anim` on <main>. That rule gives every direct child of the page the
    // same fade-and-rise, staggered 50ms apart, so the dashboard's sections
    // arrive in reading order instead of all at once. Wrapping the page in a
    // single `.sk-wfade` would REPLACE that stagger with one flat fade of an
    // identical curve — the same gesture, less information. So the fragment
    // stays, and the sections below are the animated units.
    <>
      <header className="sk-pagehead">
        <h1>Welcome back</h1>
        <p>Set up your school and manage it from here.</p>
      </header>

      {/* The Morning Bell — the day's first look, subsuming the old leave
          alert (its lines carry pending leave AND uncovered periods, so the
          same fact never renders twice on this page). */}
      {bellQuery.data && <BellCard bell={bellQuery.data} />}

      {/* At-a-glance KPIs — always shown */}
      <div className="sk-kpis" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {/* The three roll counts are read against each other ("400 students,
            22 teachers, 14 classes"), so they get the register's monospace
            face and tabular figures — the digits then sit on one grid and the
            numbers stop jittering as each query settles. */}
        <div className="sk-kpi">
          <span className="lab">Students</span>
          <span className="n sk-num">{kpiValue(studentsQuery, students.length)}</span>
        </div>
        <div className="sk-kpi">
          <span className="lab">Teachers</span>
          <span className="n sk-num">{kpiValue(teachersQuery, teachers.length)}</span>
        </div>
        <div className="sk-kpi">
          <span className="lab">Classes</span>
          <span className="n sk-num">{kpiValue(classesQuery, classes.length)}</span>
        </div>
      </div>

      {/* Setup checklist — hidden once everything is done */}
      {!allDone && (
        <div className="sk-card" style={{ marginBottom: 18 }}>
          <div
            className="sk-card-h"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
          >
            <h3>Finish setting up your school</h3>
            <span className="sk-muted sk-num">
              {doneCount} of {steps.length} done
            </span>
          </div>
          <div className="sk-card-b">
            {anySetupLoading && <p className="sk-state">Checking your setup…</p>}
            {!anySetupLoading &&
              steps.map((step) => (
                <div key={step.key} className="sk-row" style={{ alignItems: 'center' }}>
                  <span className="sk-pill" data-tone={step.done ? 'good' : 'warn'}>
                    {step.done ? 'Done' : 'To do'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{step.label}</div>
                    <div className="meta">{step.helper}</div>
                  </div>
                  <Link href={step.href} className="sk-btn sk-press">
                    {step.done ? 'Review' : 'Set up'}
                  </Link>
                </div>
              ))}
          </div>
        </div>
      )}

      {allDone && (
        <div className="sk-card" style={{ marginBottom: 18, padding: '14px 16px' }}>
          <p style={{ margin: 0, fontWeight: 650 }}>Your school is set up 🎉</p>
          <p className="sk-muted" style={{ margin: '2px 0 0' }}>
            Everything&rsquo;s configured — manage your school from the sections in the sidebar.
          </p>
        </div>
      )}

      {/* Quick action */}
      <Link href="/app/website" className="sk-entity sk-press" style={{ maxWidth: 360 }}>
        <span
          className="av"
          style={{ background: 'var(--sk-brand)' }}
        >
          <Globe className="h-5 w-5" />
        </span>
        <div>
          <div className="nm">Edit your website</div>
          <div className="meta">Update your homepage, gallery, and contact info.</div>
        </div>
      </Link>
    </>
  );
}
