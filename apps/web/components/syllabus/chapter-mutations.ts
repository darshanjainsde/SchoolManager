'use client';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ApiClient } from '@/lib/api';

// Kept apart from shared.tsx on purpose: the route-contract scan follows
// imports, and the student portal imports shared.tsx for NotInPlan — these
// three calls are teacher/admin doors and must never look reachable from there.
/** Add / rename / retire, shared by the teacher's track page and the admin's chapter page. */
export function useChapterMutations(api: Pick<ApiClient, 'post' | 'patch' | 'del'>, invalidate: QueryKey[]) {
  const qc = useQueryClient();
  const done = (msg: string) => () => {
    for (const k of invalidate) void qc.invalidateQueries({ queryKey: k });
    toast.success(msg);
  };
  const fail = (e: Error) => toast.error(e.message);
  const add = useMutation({
    mutationFn: (b: { gradeId: string; subjectId: string; title: string; parentId?: string }) => api.post<{ id: string }>('/manage/syllabus/chapters', b),
    onSuccess: done('Added for every section of the class.'),
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.patch<{ id: string }>(`/manage/syllabus/chapters/${id}`, { title }),
    onSuccess: done('Renamed.'),
    onError: fail,
  });
  const retire = useMutation({
    mutationFn: (id: string) => api.del<void>(`/manage/syllabus/chapters/${id}`),
    onSuccess: done('Removed. Progress already logged is kept.'),
    onError: fail,
  });
  return { add, rename, retire, busy: add.isPending || rename.isPending || retire.isPending };
}

