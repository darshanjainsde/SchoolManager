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
    // The API now creates one Announcement row per targeted class section
    // (a school-wide post is still a single-element array) — the mutation's
    // result is unused below, but the generic should describe what the
    // endpoint actually returns.
    mutationFn: (data: CreateAnnouncementBody) =>
      api.post<Announcement[]>('/manage/announcements', data),
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
      {/* `sk-pagehead` supplies the portal's serif heading — see /app/events. */}
      <header className="sk-pagehead flex items-center justify-between" style={{ marginBottom: 0 }}>
        <div>
          <h1>Announcements</h1>
          <p>Post announcements to the whole school or a specific class.</p>
        </div>
        <Button className="sk-press" onClick={() => setShowAdd((v) => !v)} variant="outline">
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
        <p className="text-sm" style={{ color: 'var(--sk-ink-3)' }}>Loading announcements…</p>
      )}
      {announcementsQuery.error && (
        <p className="text-sm" style={{ color: 'var(--sk-bad)' }}>
          {(announcementsQuery.error as Error).message}
        </p>
      )}

      {/* Empty state */}
      {!announcementsQuery.isLoading && (announcementsQuery.data?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Megaphone className="h-10 w-10" style={{ color: 'var(--sk-ink-3)' }} />
          <p className="text-sm" style={{ color: 'var(--sk-ink-3)' }}>No announcements yet. Post one above.</p>
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
                <Td className="font-medium max-w-xs" style={{ color: 'var(--sk-ink)' }}>
                  <div className="truncate">{ann.title}</div>
                  {ann.body && (
                    <div className="text-xs truncate mt-0.5" style={{ color: 'var(--sk-ink-3)' }}>{ann.body}</div>
                  )}
                </Td>
                <Td>
                  {ann.classSection ? (
                    <span className="sk-pill" data-tone="info">
                      {ann.classSection.name}
                    </span>
                  ) : (
                    <span className="sk-pill" data-tone="neutral">
                      Whole school
                    </span>
                  )}
                </Td>
                <Td className="text-sm whitespace-nowrap" style={{ color: 'var(--sk-ink-3)' }}>
                  {formatDate(ann.createdAt)}
                </Td>
                <Td>
                  <Button
                    className="sk-press"
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(ann.id)}
                    style={{ color: 'var(--sk-bad)' }}
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
