'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { CourseRow } from './courses-tab';

interface HofEntry {
  courseId: string;
  rank: number;
  name: string;
  achievement?: string | null;
  year?: string | null;
  photoAssetId?: string | null;
}

interface MediaAsset {
  id: string;
  url: string;
}

interface SlotForm {
  name: string;
  achievement: string;
  year: string;
  photoAssetId: string | null;
  photoPreviewUrl: string | null;
}

const MEDALS = ['🥇', '🥈', '🥉'];
const EMPTY_SLOT: SlotForm = { name: '', achievement: '', year: '', photoAssetId: null, photoPreviewUrl: null };

export default function HallOfFameTab() {
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
  const hofQuery = useQuery({
    queryKey: ['site-hof'],
    queryFn: () => api.get<HofEntry[]>('/site/hall-of-fame'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const mediaQuery = useQuery({
    queryKey: ['site-media-hof'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=HOF'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const photoUrl = (id?: string | null) => (id ? mediaQuery.data?.find((a) => a.id === id)?.url ?? null : null);

  const courses = coursesQuery.data ?? [];
  const [courseId, setCourseId] = useState('');
  const [slots, setSlots] = useState<SlotForm[]>([EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT]);
  const activeCourseId = courseId || courses[0]?.id || '';

  // Hydrate the three slots whenever the selected course or fetched data changes.
  useEffect(() => {
    if (!activeCourseId) return;
    const entries = (hofQuery.data ?? []).filter((e) => e.courseId === activeCourseId);
    setSlots(
      [1, 2, 3].map((rank) => {
        const e = entries.find((x) => x.rank === rank);
        return e
          ? {
              name: e.name,
              achievement: e.achievement ?? '',
              year: e.year ?? '',
              photoAssetId: e.photoAssetId ?? null,
              photoPreviewUrl: null,
            }
          : EMPTY_SLOT;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourseId, hofQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/site/hall-of-fame/${activeCourseId}`, {
        entries: slots
          .map((s, i) => ({ ...s, rank: i + 1 }))
          .filter((s) => s.name.trim())
          .map((s) => ({
            rank: s.rank,
            name: s.name.trim(),
            achievement: s.achievement.trim() || undefined,
            year: s.year.trim() || undefined,
            photoAssetId: s.photoAssetId ?? undefined,
          })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-hof'] });
      toast.success('Hall of Fame saved');
    },
    onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
  });

  function updateSlot(idx: number, patch: Partial<SlotForm>) {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  if (courses.length === 0 && !coursesQuery.isLoading) {
    return (
      <p className="text-sm text-slate-400 max-w-lg">
        Add courses in the Courses tab first — Hall of Fame entries are configured per class/course.
      </p>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Hall of Fame</h2>
        <p className="text-sm text-slate-500">
          Celebrate the top three students of each class. Classes with at least one entry get an
          animated podium on your website; empty classes are simply not shown.
        </p>
      </div>

      <div className="space-y-2 max-w-xs">
        <Label htmlFor="hof-course">Class / course</Label>
        <Select id="hof-course" value={activeCourseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {slots.map((slot, i) => (
          <HofSlot
            key={`${activeCourseId}-${i}`}
            medal={MEDALS[i]}
            rankLabel={['1st', '2nd', '3rd'][i]}
            slot={slot}
            existingPhotoUrl={photoUrl(slot.photoAssetId)}
            onChange={(patch) => updateSlot(i, patch)}
            api={api}
            onUploaded={() => void queryClient.invalidateQueries({ queryKey: ['site-media-hof'] })}
          />
        ))}
      </div>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !activeCourseId}>
        {saveMutation.isPending ? 'Saving…' : 'Save Hall of Fame'}
      </Button>
    </div>
  );
}

function HofSlot({
  medal,
  rankLabel,
  slot,
  existingPhotoUrl,
  onChange,
  api,
  onUploaded,
}: {
  medal: string;
  rankLabel: string;
  slot: SlotForm;
  existingPhotoUrl: string | null;
  onChange: (patch: Partial<SlotForm>) => void;
  api: ReturnType<typeof useApi>;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const preview = slot.photoPreviewUrl ?? existingPhotoUrl;

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=HOF', { method: 'POST', body: fd });
      onChange({ photoAssetId: asset.id, photoPreviewUrl: asset.url });
      onUploaded();
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xl">{medal}</span> {rankLabel} place
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          {preview ? (
            <img src={preview} alt={slot.name || rankLabel} className="h-14 w-14 rounded-full object-cover border border-slate-200" />
          ) : (
            <div className="h-14 w-14 rounded-full bg-slate-100 grid place-items-center text-slate-400 text-lg">🎓</div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />
            {uploading ? 'Uploading…' : 'Photo'}
          </Button>
        </div>
        <Input value={slot.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Student name" />
        <Input value={slot.achievement} onChange={(e) => onChange({ achievement: e.target.value })} placeholder="Achievement (e.g. 98.2%)" />
        <Input value={slot.year} onChange={(e) => onChange({ year: e.target.value })} placeholder="Year (e.g. 2026)" />
        <p className="text-xs text-slate-400">Leave the name empty to clear this place.</p>
      </CardContent>
    </Card>
  );
}
