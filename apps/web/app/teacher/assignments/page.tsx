'use client';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Assignments are not implemented in the API yet (there is no assignments
 * module). This page previously called `/classes`, `/subjects` and
 * `/assignments`, none of which exist — every request 404'd and the form could
 * never be submitted. Until the feature lands, say so plainly and point
 * teachers at the tools that do work.
 */
export default function TeacherAssignmentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Assignments</h1>
        <p className="text-sm text-slate-500">Set homework and track submissions.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not available yet</CardTitle>
          <CardDescription>
            Assignments aren&apos;t part of SkoolOS yet — they&apos;re planned for a future release.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-slate-600">
          <p>In the meantime you can:</p>
          <ul className="list-inside list-disc text-slate-500">
            <li>
              <Link href="/teacher/attendance" className="text-teal-700 underline">
                Mark attendance
              </Link>{' '}
              for your classes
            </li>
            <li>
              <Link href="/teacher/tests" className="text-teal-700 underline">
                Schedule a test
              </Link>{' '}
              — students and parents are notified automatically
            </li>
            <li>
              <Link href="/teacher/results" className="text-teal-700 underline">
                Enter and publish results
              </Link>
            </li>
            <li>
              <Link href="/teacher/announcements" className="text-teal-700 underline">
                Post an announcement
              </Link>{' '}
              to your class
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
