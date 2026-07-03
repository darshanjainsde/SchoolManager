'use client';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, Pencil, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ────────────────────────────────────────────────────────────────────

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  photoAssetId?: string | null;
  primarySubjectId?: string | null;
  bio?: string | null;
  isActive: boolean;
}

interface MediaAsset {
  id: string;
  url: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(t: Teacher) {
  return `${t.firstName.charAt(0)}${t.lastName.charAt(0)}`.toUpperCase();
}

function fullName(t: Teacher) {
  return `${t.firstName} ${t.lastName}`;
}

// ── Add / Edit modal ─────────────────────────────────────────────────────────

interface TeacherFormProps {
  title: string;
  initial?: Partial<Teacher>;
  photoUrl?: string | null;
  onSave: (data: {
    firstName: string;
    lastName: string;
    email: string;
    photoAssetId: string | null;
  }) => void;
  isSaving: boolean;
  onCancel: () => void;
  onPhotoUpload: (file: File) => void;
  isUploadingPhoto: boolean;
  uploadedPhotoUrl: string | null;
}

function TeacherForm({
  title,
  initial = {},
  photoUrl,
  onSave,
  isSaving,
  onCancel,
  onPhotoUpload,
  isUploadingPhoto,
  uploadedPhotoUrl,
}: TeacherFormProps) {
  const [firstName, setFirstName] = useState(initial.firstName ?? '');
  const [lastName, setLastName] = useState(initial.lastName ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = uploadedPhotoUrl ?? photoUrl;

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tf-first">First name</Label>
            <Input
              id="tf-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tf-last">Last name</Label>
            <Input
              id="tf-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tf-email">Email (optional)</Label>
          <Input
            id="tf-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane.smith@school.com"
          />
        </div>

        {/* Photo upload */}
        <div className="space-y-2">
          <Label>Photo (optional)</Label>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Teacher photo"
              className="h-20 w-20 rounded-full object-cover border border-slate-200"
            />
          ) : initial.photoAssetId ? (
            <p className="text-sm text-slate-500 italic">Photo set — upload to replace.</p>
          ) : (
            <p className="text-sm text-slate-400">No photo set.</p>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPhotoUpload(f);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUploadingPhoto}
            onClick={() => photoInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-1" />
            {isUploadingPhoto ? 'Uploading…' : previewUrl || initial.photoAssetId ? 'Replace photo' : 'Upload photo'}
          </Button>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          onClick={() =>
            onSave({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
              photoAssetId: initial.photoAssetId ?? null,
            })
          }
          disabled={isSaving || !firstName.trim() || !lastName.trim()}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TeachersPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Photo state for the add form
  const [addPhotoAssetId, setAddPhotoAssetId] = useState<string | null>(null);
  const [addPhotoUrl, setAddPhotoUrl] = useState<string | null>(null);
  const [isUploadingAddPhoto, setIsUploadingAddPhoto] = useState(false);

  // Photo state for the edit form
  const [editPhotoAssetId, setEditPhotoAssetId] = useState<string | null>(null);
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [isUploadingEditPhoto, setIsUploadingEditPhoto] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────
  const teachersQuery = useQuery({
    queryKey: ['mng-teachers'],
    queryFn: () => api.get<Teacher[]>('/manage/teachers'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Media for resolving photo URLs
  const staffMediaQuery = useQuery({
    queryKey: ['site-media-staff'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=STAFF'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const photoUrlMap: Record<string, string> = {};
  for (const asset of staffMediaQuery.data ?? []) {
    photoUrlMap[asset.id] = asset.url;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (body: {
      firstName: string;
      lastName: string;
      email?: string;
      photoAssetId?: string | null;
    }) => api.post<Teacher>('/manage/teachers', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
      setShowAdd(false);
      resetAddForm();
      toast.success('Teacher added');
    },
    onError: (err: Error) => toast.error(`Failed to add teacher: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      firstName: string;
      lastName: string;
      email?: string;
      photoAssetId?: string | null;
    }) => api.put<Teacher>(`/manage/teachers/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
      setEditId(null);
      resetEditForm();
      toast.success('Teacher updated');
    },
    onError: (err: Error) => toast.error(`Failed to update teacher: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/teachers/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
      toast.success('Teacher removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete teacher: ${err.message}`),
  });

  // ── Upload helpers ────────────────────────────────────────────────────────
  async function uploadPhoto(
    file: File,
    setAssetId: (id: string) => void,
    setUrl: (url: string) => void,
    setUploading: (v: boolean) => void,
  ) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=STAFF', {
        method: 'POST',
        body: fd,
      });
      setAssetId(asset.id);
      setUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-media-staff'] });
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  function resetAddForm() {
    setAddPhotoAssetId(null);
    setAddPhotoUrl(null);
  }

  function resetEditForm() {
    setEditPhotoAssetId(null);
    setEditPhotoUrl(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Teachers</h1>
          <p className="mt-1 text-sm text-slate-500">Manage your school&apos;s teaching staff.</p>
        </div>
        <Button
          onClick={() => {
            setShowAdd((v) => !v);
            setEditId(null);
          }}
          variant="outline"
        >
          {showAdd ? (
            <>
              <X className="h-4 w-4 mr-1" /> Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" /> Add teacher
            </>
          )}
        </Button>
      </header>

      {/* Add form */}
      {showAdd && (
        <TeacherForm
          title="Add teacher"
          onSave={({ firstName, lastName, email, photoAssetId }) =>
            addMutation.mutate({
              firstName,
              lastName,
              email: email || undefined,
              photoAssetId: addPhotoAssetId ?? photoAssetId,
            })
          }
          isSaving={addMutation.isPending}
          onCancel={() => {
            setShowAdd(false);
            resetAddForm();
          }}
          onPhotoUpload={(f) =>
            void uploadPhoto(f, setAddPhotoAssetId, setAddPhotoUrl, setIsUploadingAddPhoto)
          }
          isUploadingPhoto={isUploadingAddPhoto}
          uploadedPhotoUrl={addPhotoUrl}
        />
      )}

      {/* Loading / error states */}
      {teachersQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {teachersQuery.error && (
        <p className="text-sm text-rose-600">{(teachersQuery.error as Error).message}</p>
      )}

      {/* Empty state */}
      {!teachersQuery.isLoading && teachersQuery.data?.length === 0 && (
        <p className="text-sm text-slate-400">No teachers yet. Add one above.</p>
      )}

      {/* Teacher grid */}
      {(teachersQuery.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teachersQuery.data!.map((teacher) =>
            editId === teacher.id ? (
              <TeacherForm
                key={teacher.id}
                title="Edit teacher"
                initial={teacher}
                photoUrl={teacher.photoAssetId ? (photoUrlMap[teacher.photoAssetId] ?? null) : null}
                onSave={({ firstName, lastName, email }) =>
                  updateMutation.mutate({
                    id: teacher.id,
                    firstName,
                    lastName,
                    email: email || undefined,
                    photoAssetId: editPhotoAssetId ?? teacher.photoAssetId ?? null,
                  })
                }
                isSaving={updateMutation.isPending}
                onCancel={() => {
                  setEditId(null);
                  resetEditForm();
                }}
                onPhotoUpload={(f) =>
                  void uploadPhoto(f, setEditPhotoAssetId, setEditPhotoUrl, setIsUploadingEditPhoto)
                }
                isUploadingPhoto={isUploadingEditPhoto}
                uploadedPhotoUrl={editPhotoUrl}
              />
            ) : (
              <Card key={teacher.id}>
                <CardContent className="flex items-start gap-4 pt-4">
                  {teacher.photoAssetId && photoUrlMap[teacher.photoAssetId] ? (
                    <img
                      src={photoUrlMap[teacher.photoAssetId]}
                      alt={fullName(teacher)}
                      className="h-14 w-14 rounded-full object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-teal-100 flex items-center justify-center shrink-0 text-teal-700 font-semibold select-none">
                      {initials(teacher)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{fullName(teacher)}</p>
                    {teacher.email && (
                      <p className="text-sm text-slate-500 truncate">{teacher.email}</p>
                    )}
                    {!teacher.isActive && (
                      <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        Inactive
                      </span>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="gap-2 pt-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAdd(false);
                      setEditId(teacher.id);
                      resetEditForm();
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(teacher.id)}
                    className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </CardFooter>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
