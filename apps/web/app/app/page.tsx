'use client';
import Link from 'next/link';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { DashboardPulse, MorningBell } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { Z } from '@/lib/z-layers';
import { useHost } from '@/components/use-host';
import { BellCard } from './bell-card';
import { CommandBar, type BarAction } from './command-bar';
import { Dock, type DockDrawerKind } from './dock';
import { PulseTiles } from './pulse-tiles';

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

  // THE SIX SETUP TICKS USED TO COST SIX WHOLE COLLECTIONS.
  //
  // This page asked "has the school added students yet?" by downloading every
  // student on the roll and checking `length > 0` — measured at 227 KB per 500
  // children, so a real school shipped megabytes to draw a tick. The same held
  // for years, periods, subjects, classes and teachers. Six requests, six
  // whole tables, six answers that are each one bit.
  //
  // Worse than the bytes: each was a separate request, and a burst of ten
  // concurrent calls makes the platform start extra serverless instances. The
  // ones that cold-start cost about two seconds — measured on this very page,
  // where /manage/subjects took 2,071 ms in the burst and 209 ms on its own.
  // Cutting the burst is what makes the page feel fast, not the payload.
  //
  // The pulse this page already asks for now carries all six as booleans.
  const pulseQuery = useQuery({
    queryKey: ['pulse', host], enabled: !!host,
    queryFn: () => api.get<DashboardPulse>('/manage/pulse'),
    refetchInterval: 5 * 60_000,
  });
  const [drawer, setDrawer] = useState<DockDrawerKind | null>(null);
  const hasFees = pulseQuery.data ? pulseQuery.data.fees !== null : false;

  /** What the command bar can DO, beyond finding people. */
  const barActions: BarAction[] = [
    ...(hasFees ? [{ label: 'Record a counter payment', hint: 'Fees → the verify queue', keywords: 'record payment fee cash counter paisa', run: () => setDrawer('pay') }] : []),
    { label: 'New enquiry', hint: 'Admissions queue', keywords: 'enquiry admission walk-in lead', run: () => setDrawer('enquiry') },
    { label: 'Make an announcement', hint: 'School-wide, every portal', keywords: 'announce announcement notice circular', run: () => setDrawer('announce') },
  ];

  const bellQuery = useQuery({
    queryKey: ['bell', host], enabled: !!host,
    queryFn: () => api.get<MorningBell>('/manage/bell'),
    // The Bell describes a morning; re-ring it if the tab stays open.
    refetchInterval: 5 * 60_000,
  });


  // `setup` is absent when the console is talking to an API that predates it
  // (the web deploys before the API). Hiding the checklist for those few
  // minutes is right: six red crosses on a school that finished setting up
  // months ago would be worse than showing nothing.
  const setup = pulseQuery.data?.setup ?? null;

  // A resource that errors resolves to an empty array above, so a step just
  // reads as "not done yet" rather than crashing the page.
  const steps: SetupStep[] = [
    {
      key: 'year',
      label: 'Set your academic year',
      helper: 'Define the current school year so records have somewhere to live.',
      href: '/app/settings',
      // Any year is enough, but a year marked "current" satisfies it too.
      done: setup?.year ?? false,
    },
    {
      key: 'periods',
      label: 'Add class periods (bell times)',
      helper: 'Set up the daily schedule blocks your classes will run in.',
      href: '/app/settings',
      done: setup?.periods ?? false,
    },
    {
      key: 'subjects',
      label: 'Add grades & subjects',
      helper: 'Create the grade levels and subjects your school teaches.',
      href: '/app/classes/structure',
      done: setup?.subjects ?? false,
    },
    {
      key: 'classes',
      label: 'Create classes',
      helper: 'Set up class sections for each grade.',
      href: '/app/classes',
      done: setup?.classes ?? false,
    },
    {
      key: 'teachers',
      label: 'Add teachers',
      helper: 'Invite teachers so they can take attendance and record results.',
      href: '/app/teachers',
      done: setup?.teachers ?? false,
    },
    {
      key: 'students',
      label: 'Add students',
      helper: 'Enroll students and assign them to their classes.',
      href: '/app/students',
      done: setup?.students ?? false,
    },
    {
      key: 'timetable',
      label: 'Build the timetable',
      helper: 'Assign subjects and teachers to periods for each class.',
      href: '/app/timetable',
      // No endpoint to check timetable entries directly — once classes exist
      // the timetable is buildable, so we treat that as this step's signal.
      done: setup?.classes ?? false,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const anySetupLoading = pulseQuery.isLoading;

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
        <p>Ask for anything, act in one tap — the desk is yours.</p>
      </header>

      {/* The command bar — the Front Desk's front door.
          position:relative + z-index on THIS wrapper is load-bearing: it is a
          direct child of the layout's `.sk-anim`, whose entrance animation
          (fill-mode: both) leaves every sibling a PERSISTENT stacking
          context — so without it, the bell/dock row (a later sibling) paints
          OVER the bar's dropdown no matter how high the dropdown's own
          z-index goes. Proven in headless Chrome with the real sk-rise rule:
          later-sibling card covers a z-40 menu; wrapper z-60 wins. Same root
          as the twice-logged trapped-modal bug, in z-order form. 60 stays
          below the drawers' 80, so a drawer still covers everything. */}
      <div style={{ marginBottom: 18, position: 'relative', zIndex: Z.PAGE_CHROME }}>
        <CommandBar actions={barActions} />
      </div>

      {/* The Bell and the dock share the desk row: what needs you, and what
          you reach for. */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: '1.7 1 340px', minWidth: 0 }}>
          {bellQuery.data ? <BellCard bell={bellQuery.data} /> : <p className="sk-state">Ringing the bell…</p>}
        </div>
        <div style={{ flex: '1 1 260px' }}>
          <Dock hasFees={hasFees} open={drawer} setOpen={setDrawer} />
        </div>
      </div>

      {/* The pulse — living tiles, replacing the three static counts. */}
      {pulseQuery.data && <div style={{ marginBottom: 18 }}><PulseTiles pulse={pulseQuery.data} /></div>}

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

    </>
  );
}
