'use client';
import Link from 'next/link';
import {
  Bell, CalendarHeart, CalendarX, ClipboardCheck, Inbox, UserX, Users, Wallet,
} from 'lucide-react';
import type { MorningBell } from '@skoolos/types';
import { rupees } from '@/lib/fees';

/**
 * The Morning Bell — the principal's first look of the day, pinned to the top
 * of the dashboard.
 *
 * Pure render: the page owns the query, this card owns the words. Every row
 * is a LINK to the screen that fixes it (a queue, never a report), and a row
 * with nothing to say does not render — a quiet morning is one calm line, not
 * six zeros.
 */

function Row({
  href, icon, tone, children,
}: {
  href: string; icon: React.ReactNode; tone?: 'warn' | 'bad'; children: React.ReactNode;
}) {
  return (
    <Link href={href} className="sk-row sk-press" style={{ alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
      <span
        className="av"
        style={{
          width: 34, height: 34, borderRadius: 10, flex: 'none', display: 'grid', placeItems: 'center',
          background: tone === 'bad' ? 'var(--sk-bad-tint)' : tone === 'warn' ? 'var(--sk-amber-tint)' : 'var(--sk-brand-tint)',
          color: tone === 'bad' ? 'var(--sk-bad)' : tone === 'warn' ? 'var(--sk-amber-ink)' : 'var(--sk-brand-2)',
        }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{children}</div>
    </Link>
  );
}

/** "Sunita Joshi and Ram Meghwal" · "Sunita Joshi, Ram Meghwal and 2 more" */
function nameList(names: string[], cap = 3): string {
  if (names.length <= cap) {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, cap).join(', ')} and ${names.length - cap} more`;
}

export function BellCard({ bell }: { bell: MorningBell }) {
  const quiet =
    bell.staffAbsent.length === 0 &&
    bell.uncovered.length === 0 &&
    bell.students.absent === 0 &&
    bell.upcomingUncovered === 0 &&
    (bell.fees?.awaitingReview ?? 0) === 0 &&
    bell.waiting.leave === 0 &&
    bell.waiting.registerChanges === 0 &&
    bell.waiting.enquiries === 0;

  return (
    <div className="sk-card" style={{ marginBottom: 18 }}>
      <div className="sk-card-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={15} style={{ color: 'var(--sk-amber)' }} aria-hidden="true" />
          The Morning Bell
        </h3>
        <span className="sk-muted" style={{ fontSize: 12.5 }}>{bell.dateLabel}</span>
      </div>
      <div className="sk-card-b" style={{ gap: 4 }}>
        {bell.today.holiday && (
          <p className="sk-state" style={{ margin: 0 }}>
            Today is <b>{bell.today.holiday}</b> — the school calendar marks it a holiday.
          </p>
        )}

        {bell.staffAbsent.length > 0 && (
          <Row href="/app/staff-attendance" icon={<UserX size={16} />} tone="warn">
            <b>{bell.staffAbsent.length} not in today</b> —{' '}
            {nameList(bell.staffAbsent.map((s) => (s.kind === 'TEACHER' ? s.name : `${s.name} (staff)`)))}
          </Row>
        )}

        {bell.uncovered.length > 0 && (
          <Row href="/app/leave" icon={<CalendarX size={16} />} tone="bad">
            <b>
              {bell.uncovered.length} class {bell.uncovered.length === 1 ? 'period has' : 'periods have'} no teacher
            </b>{' '}
            — {nameList(bell.uncovered.map((u) => `${u.className} ${u.periodLabel}`), 4)}. Assign substitutes.
          </Row>
        )}

        {bell.students.absent > 0 && (
          <Row href="/app/classes" icon={<Users size={16} />}>
            <b>{bell.students.absent} students absent</b> of {bell.students.marked} marked so far
            {bell.students.worst ? <> · {bell.students.worst.className} worst ({bell.students.worst.absent})</> : null}
          </Row>
        )}

        {bell.fees && (bell.fees.yesterdayMinor > 0 || bell.fees.monthMinor > 0 || bell.fees.awaitingReview > 0) && (
          <Row href={bell.fees.awaitingReview > 0 ? '/app/fees/verify' : '/app/fees'} icon={<Wallet size={16} />}
            tone={bell.fees.awaitingReview > 0 ? 'warn' : undefined}>
            <b>{rupees(bell.fees.yesterdayMinor)} collected yesterday</b> · {rupees(bell.fees.monthMinor)} this month
            {bell.fees.awaitingReview > 0 ? <> · <b>{bell.fees.awaitingReview} to check</b></> : null}
          </Row>
        )}

        {bell.today.events.length > 0 && (
          <Row href="/app/events" icon={<CalendarHeart size={16} />}>
            <b>Today:</b> {bell.today.events.map((e) => `${e.title} (${e.time})`).join(' · ')}
          </Row>
        )}

        {bell.upcomingUncovered > 0 && (
          <Row href="/app/leave" icon={<CalendarX size={16} />} tone="warn">
            <b>{bell.upcomingUncovered} {bell.upcomingUncovered === 1 ? 'period' : 'periods'} in the next 30 days</b>{' '}
            still {bell.upcomingUncovered === 1 ? 'needs' : 'need'} a substitute
          </Row>
        )}

        {bell.waiting.leave > 0 && (
          <Row href="/app/leave" icon={<ClipboardCheck size={16} />} tone="warn">
            <b>{bell.waiting.leave} leave {bell.waiting.leave === 1 ? 'request' : 'requests'}</b> waiting for a decision
          </Row>
        )}
        {bell.waiting.registerChanges > 0 && (
          <Row href="/app/requests" icon={<ClipboardCheck size={16} />} tone="warn">
            <b>{bell.waiting.registerChanges} register {bell.waiting.registerChanges === 1 ? 'change' : 'changes'}</b> waiting for approval
          </Row>
        )}
        {bell.waiting.enquiries > 0 && (
          <Row href="/app/enquiries" icon={<Inbox size={16} />}>
            <b>{bell.waiting.enquiries} new {bell.waiting.enquiries === 1 ? 'enquiry' : 'enquiries'}</b> from the website
          </Row>
        )}

        {quiet && (
          <p className="sk-state" style={{ margin: 0 }}>
            All quiet — no absences marked yet and every queue is empty. A good morning.
          </p>
        )}
      </div>
    </div>
  );
}
