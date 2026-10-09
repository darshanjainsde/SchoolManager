import { useEffect, useState } from 'react';
import type { MyClassSection, Subject, TeacherProfile } from '@skoolos/types';
import { api } from './api';
import type { SelectOption } from '@/components/Field';

/**
 * The subjects THIS teacher teaches, by name (from their profile). Used to
 * list "Your subjects" first in a subject dropdown and to pre-pick the only
 * one. Best-effort: a failed or missing profile simply means no grouping —
 * a dropdown must never be blocked by a nicety.
 */
export function useMySubjectNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    try {
      Promise.resolve(api.request<TeacherProfile>('/manage/teachers/me'))
        .then((p) => {
          if (!cancelled && p && Array.isArray(p.subjects)) setNames(p.subjects);
        })
        .catch(() => undefined);
    } catch {
      /* a mocked or offline api that throws synchronously — no grouping */
    }
    return () => {
      cancelled = true;
    };
  }, []);
  return names;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Subject options: full name first, code as the second line, the teacher's own on top. */
export function subjectOptions(subjects: readonly Subject[], mine: readonly string[]): SelectOption[] {
  const own = new Set(mine.map(norm));
  const opts = subjects.map((s) => ({
    id: s.id,
    label: s.name,
    sub: s.code,
    group: own.size ? (own.has(norm(s.name)) ? 'Your subjects' : 'All subjects') : undefined,
  }));
  const rank = (o: SelectOption) => (o.group === 'Your subjects' ? 0 : 1);
  return opts.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** The one subject to pre-pick: only when the teacher teaches exactly one that the school lists. */
export function onlyOwnSubject(subjects: readonly Subject[], mine: readonly string[]): string | null {
  const own = new Set(mine.map(norm));
  const hits = subjects.filter((s) => own.has(norm(s.name)));
  return hits.length === 1 ? hits[0].id : null;
}

/** Class options: the class name, its roll size as the second line. */
export function classOptions(classes: readonly MyClassSection[]): SelectOption[] {
  return classes.map((c) => ({ id: c.classSectionId, label: c.name, sub: `${c.studentCount} students` }));
}

/** ISO date `n` days after `iso`. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
