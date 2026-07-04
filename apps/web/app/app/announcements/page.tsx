'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, X, Megaphone } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';

// ── Types ────────────────────────────────────────────────────────────────────

interface SchoolClass {
  id: string;
  name: string;
  grade: { name: string };
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  classSectionId: string | null;
  classSection: { name: string } | null;
  createdAt: string;
}

interface CreateAnnouncementBody {
  title: string;
  body: string;
  classSectionId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// ── Create form ───────────────────────────────────────────────────────────────

interface AnnouncementFormProps {
  classes: SchoolClass[];
  onSave: (data: CreateAnnouncementBody) => void;
  isSaving: boolean;
  onCancel: () => void;
}

function AnnouncementForm({ classes, onSave, isSaving, onCancel }: AnnouncementFormProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [classSectionId, setClassSectionId] = useState('');

  const canSave = title.trim() && body.trim();

  function handleSubmit() {
    const data: CreateAnnouncementBody = {
      title: title.trim(),
      body: body.trim(),
    };
    if (classSectionId) data.classSectionId = classSectionId;
    onSave(data);
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>New announcement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ann-title">Title *</Label>
          <Input
            id="ann-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="End-of-term assembly"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ann-body">Message *</Label>
          <Textarea
            id="ann-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the announcement here…"
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ann-class">Target audience</Label>
          <Select
            id="ann-class"
            value={classSectionId}
            onChange={(e) => setClassSectionId(e.target.value)}
          >
            <option value="">Whole school</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.grade.name} — {c.name}
              </option>
            ))}
          </Select>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={handleSubmit} disabled={isSaving || !canSave}>
          {isSaving ? 'Posting…' : 'Post announcement'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────
  const announcementsQuery = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get<Announcement[]>('/manage/announcements'),
    enabled: !!host,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    enabled: !!host,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: CreateAnnouncementBody) =>
      api.post<Announcement>('/manage/announcements', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      setShowAdd(false);
      toast.success('Announcement posted.');
    },
    onError: (err: Error) => toast.error(`Failed to post announcement: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/announcements/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Announcement deleted.');
    },
    onError: (err: Error) => toast.error(`Failed to delete announcement: ${err.message}`),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Announcements</h1>
          <p className="mt-1 text-sm text-slate-500">
            Post announcements to the whole school or a specific class.
          </p>
        </div>
        <Button onClick={() => setShowAdd((v) => !v)} variant="outline">
          {showAdd ? (
            <>
              <X className="h-4 w-4 mr-1" /> Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" /> New announcement
            </>
          )}
        </Button>
      </header>

      {/* Create form */}
      {showAdd && (
        <AnnouncementForm
          classes={classesQuery.data ?? []}
          onSave={(data) => createMutation.mutate(data)}
          isSaving={createMutation.isPending}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Loading / error states */}
      {announcementsQuery.isLoading && (
        <p className="text-sm text-slate-500">Loading announcements…</p>
      )}
      {announcementsQuery.error && (
        <p className="text-sm text-rose-600">
          {(announcementsQuery.error as Error).message}
        </p>
      )}

      {/* Empty state */}
      {!announcementsQuery.isLoading && (announcementsQuery.data?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Megaphone className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No announcements yet. Post one above.</p>
        </div>
      )}

      {/* Announcements table */}
      {(announcementsQuery.data?.length ?? 0) > 0 && (
        <Table>
          <THead>
            <Tr>
              <Th>Title</Th>
              <Th>Target</Th>
              <Th>Date</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {announcementsQuery.data!.map((ann) => (
              <Tr key={ann.id}>
                <Td className="font-medium text-slate-900 max-w-xs">
                  <div className="truncate">{ann.title}</div>
                  {ann.body && (
                    <div className="text-xs text-slate-400 truncate mt-0.5">{ann.body}</div>
                  )}
                </Td>
                <Td>
                  {ann.classSection ? (
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {ann.classSection.name}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Whole school
                    </span>
                  )}
                </Td>
                <Td className="text-slate-500 text-sm whitespace-nowrap">
                  {formatDate(ann.createdAt)}
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(ann.id)}
                    className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
