import { redirect } from 'next/navigation';

/**
 * `/teacher/leave` moved to `/teacher/requests` (Task 5 — it now merges leave
 * applications with register-change requests into one queue). Kept as a
 * redirect so an existing bookmark or a link in an old email doesn't 404.
 */
export default function TeacherLeavePageRedirect() {
  redirect('/teacher/requests');
}
