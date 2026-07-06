'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Star, Trash2, Upload } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export interface CourseRow {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  highlights: string[];
  ageRange?: string | null;
  imageAssetId?: string | null;
  featured: boolean;
  order: number;
  fee?: { admissionFee?: string | null; annualFee?: string | null; includes?: string | null } | null;
}

interface MediaAsset {
  id: string;
  url: string;
}

interface CourseForm {
  name: string;
  ageRange: string;
  tagline: string;
  description: string;
  highlights: string; // one per line
  featured: boolean;
  imageAssetId: string | null;
  imagePreviewUrl: string | null;
  admissionFee: string;
  annualFee: string;
  includes: string;
}

const EMPTY_FORM: CourseForm = {
  name: '',
  ageRange: '',
  tagline: '',
  description: '',
  highlights: '',
  featured: false,
  imageAssetId: null,
  imagePreviewUrl: null,
  admissionFee: '',
  annualFee: '',
  includes: '',
};

function toPayload(f: CourseForm, order: number) {
  return {
    name: f.name.trim(),
    tagline: f.tagline.trim() || undefined,
    description: f.description.trim() || undefined,
    highlights: f.highlights.split('\n').map((h) => h.trim()).filter(Boolean).slice(0, 12),
    ageRange: f.ageRange.trim() || undefined,
    imageAssetId: f.imageAssetId ?? undefined,
    featured: f.featured,
    order,
  };
}

export default function CoursesTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const coursesQuery = useQuery({
    queryKey: ['site-courses'],
    queryFn: () => api.get<CourseRow[]>('/site/courses'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const mediaQuery = useQuery({
    queryKey: ['site-media-course'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=COURSE'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const imageUrl = (id?: string | null) => (id ? mediaQuery.data?.find((a) => a.id === id)?.url ?? null : null);

  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<CourseForm>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof CourseForm>(k: K, v: CourseForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['site-courses'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const courses = coursesQuery.data ?? [];
      let id: string;
      if (editingId === 'new') {
        const created = await api.post<CourseRow>('/site/courses', toPayload(form, courses.length));
        id = created.id;
      } else {
        const existing = courses.find((c) => c.id === editingId)!;
        await api.put(`/site/courses/${editingId}`, toPayload(form, existing.order));
        id = existing.id;
      }
      const fee = { admissionFee: form.admissionFee.trim(), annualFee: form.annualFee.trim(), includes: form.includes.trim() };
      if (fee.admissionFee || fee.annualFee || fee.includes) {
        await api.put(`/site/courses/${id}/fee`, fee);
      }
    },
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setForm(EMPTY_FORM);
      toast.success('Course saved');
    },
    onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.request(`/site/courses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Course deleted');
    },
    onError: (e) => toast.error(`Delete failed: ${(e as Error).message}`),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: -1 | 1 }) => {
      const courses = [...(coursesQuery.data ?? [])];
      const idx = courses.findIndex((c) => c.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= courses.length) return;
      const a = courses[idx];
      const b = courses[swap];
      const body = (c: CourseRow, order: number) => ({
        name: c.name,
        tagline: c.tagline ?? undefined,
        description: c.description ?? undefined,
        highlights: c.highlights,
        ageRange: c.ageRange ?? undefined,
        imageAssetId: c.imageAssetId ?? undefined,
        featured: c.featured,
        order,
      });
      await Promise.all([
        api.put(`/site/courses/${a.id}`, body(a, b.order)),
        api.put(`/site/courses/${b.id}`, body(b, a.order)),
      ]);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(`Reorder failed: ${(e as Error).message}`),
  });

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=COURSE', { method: 'POST', body: fd });
      setForm((f) => ({ ...f, imageAssetId: asset.id, imagePreviewUrl: asset.url }));
      void queryClient.invalidateQueries({ queryKey: ['site-media-course'] });
      toast.success('Image uploaded');
    } catch (err) {
      toast.error(`Image upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  function startEdit(c: CourseRow) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      ageRange: c.ageRange ?? '',
      tagline: c.tagline ?? '',
      description: c.description ?? '',
      highlights: c.highlights.join('\n'),
      featured: c.featured,
      imageAssetId: c.imageAssetId ?? null,
      imagePreviewUrl: imageUrl(c.imageAssetId),
      admissionFee: c.fee?.admissionFee ?? '',
      annualFee: c.fee?.annualFee ?? '',
      includes: c.fee?.includes ?? '',
    });
  }

  const courses = coursesQuery.data ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Courses offered</h2>
          <p className="text-sm text-slate-500">
            The classes/programmes shown on your website — in the Academics section, the navbar menu
            and (for featured ones) as flip cards on the homepage.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setEditingId(editingId === 'new' ? null : 'new');
            setForm(EMPTY_FORM);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          {editingId === 'new' ? 'Cancel' : 'Add course'}
        </Button>
      </div>

      {editingId && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId === 'new' ? 'Add course' : 'Edit course'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="course-name">Course name</Label>
                <Input id="course-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Primary School" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="course-age">Age / grade range</Label>
                <Input id="course-age" value={form.ageRange} onChange={(e) => set('ageRange', e.target.value)} placeholder="Grades 1–5" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-tagline">Tagline (card front)</Label>
              <Input id="course-tagline" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Strong foundations in literacy, numeracy and curiosity." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-desc">Description</Label>
              <Textarea id="course-desc" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-highlights">Highlights (one per line, up to 12)</Label>
              <Textarea id="course-highlights" rows={3} value={form.highlights} onChange={(e) => set('highlights', e.target.value)} placeholder={'Reading programme\nHands-on math'} />
            </div>

            <div className="space-y-2">
              <Label>Course image (optional)</Label>
              {form.imagePreviewUrl ? (
                <img src={form.imagePreviewUrl} alt="Course" className="h-24 w-auto rounded border border-slate-200 object-cover" />
              ) : form.imageAssetId ? (
                <p className="text-sm text-slate-500 italic">Image set — upload a new file to replace.</p>
              ) : (
                <p className="text-sm text-slate-400">No image set.</p>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadImage(f);
                  e.target.value = '';
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />
                {uploading ? 'Uploading…' : 'Upload image'}
              </Button>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(e) => set('featured', e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-emerald-700"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">Show on homepage</span>
                <span className="block text-xs text-slate-500">
                  Featured courses appear as flip cards on the homepage. Off = visible only in the Academics section.
                </span>
              </span>
            </label>

            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <p className="text-sm font-medium text-slate-700">Fee structure row (optional)</p>
              <p className="text-xs text-slate-500">
                Shown in the Admissions fee table (free text — &ldquo;₹ 68,000&rdquo; or &ldquo;On request&rdquo; both work).
                The table can be hidden entirely from the Admissions tab.
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="fee-adm">Admission fee</Label>
                  <Input id="fee-adm" value={form.admissionFee} onChange={(e) => set('admissionFee', e.target.value)} placeholder="₹ 20,000" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fee-annual">Annual tuition</Label>
                  <Input id="fee-annual" value={form.annualFee} onChange={(e) => set('annualFee', e.target.value)} placeholder="₹ 82,000" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fee-includes">Includes</Label>
                  <Input id="fee-includes" value={form.includes} onChange={(e) => set('includes', e.target.value)} placeholder="Books, lab access" />
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name.trim()}>
              {saveMutation.isPending ? 'Saving…' : 'Save course'}
            </Button>
            <Button variant="outline" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
          </CardFooter>
        </Card>
      )}

      {coursesQuery.isLoading && <p className="text-sm text-slate-500">Loading courses…</p>}
      {coursesQuery.error && <p className="text-sm text-rose-600">{(coursesQuery.error as Error).message}</p>}
      {courses.length === 0 && !coursesQuery.isLoading && !editingId && (
        <p className="text-sm text-slate-400">No courses yet. Click &quot;Add course&quot; above.</p>
      )}

      <div className="space-y-2">
        {courses.map((c, i) => (
          <Card key={c.id}>
            <CardContent className="flex items-center gap-4 py-3">
              {imageUrl(c.imageAssetId) ? (
                <img src={imageUrl(c.imageAssetId)!} alt={c.name} className="h-12 w-16 rounded object-cover border border-slate-200 shrink-0" />
              ) : (
                <div className="h-12 w-16 rounded bg-slate-100 grid place-items-center text-slate-400 text-xs shrink-0">No image</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate flex items-center gap-1.5">
                  {c.name}
                  {c.featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Shown on homepage" />}
                </p>
                <p className="text-sm text-slate-500 truncate">
                  {[c.ageRange, c.fee?.annualFee ? `Annual ${c.fee.annualFee}` : null].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" disabled={i === 0 || moveMutation.isPending} onClick={() => moveMutation.mutate({ id: c.id, dir: -1 })} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" disabled={i === courses.length - 1 || moveMutation.isPending} onClick={() => moveMutation.mutate({ id: c.id, dir: 1 })} aria-label="Move down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => startEdit(c)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(c.id)}
                  className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
