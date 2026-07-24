'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { BlogLayoutPreset, BlogSettings, SelectionRow } from './types';

const PRESETS: { id: BlogLayoutPreset; label: string; blurb: string }[] = [
  { id: 'HERO_GRID', label: 'Hero + grid', blurb: 'Featured hero post(s) up top, then a 3-column grid.' },
  { id: 'GRID', label: 'Grid', blurb: 'A plain 3-column grid, no featured post.' },
  { id: 'LIST', label: 'List', blurb: 'A single column of rows — simplest, most compact.' },
];

function LayoutMockup({ preset }: { preset: BlogLayoutPreset }) {
  if (preset === 'HERO_GRID') {
    return (
      <div className="space-y-1">
        <div className="h-7 rounded bg-teal-300" />
        <div className="grid grid-cols-3 gap-1">
          <div className="h-4 rounded bg-slate-300" />
          <div className="h-4 rounded bg-slate-300" />
          <div className="h-4 rounded bg-slate-300" />
        </div>
      </div>
    );
  }
  if (preset === 'GRID') {
    return (
      <div className="grid grid-cols-3 gap-1">
        <div className="h-7 rounded bg-slate-300" />
        <div className="h-7 rounded bg-slate-300" />
        <div className="h-7 rounded bg-slate-300" />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="h-2.5 rounded bg-slate-300" />
      <div className="h-2.5 rounded bg-slate-300" />
      <div className="h-2.5 rounded bg-slate-300" />
    </div>
  );
}

export default function LayoutTab({
  settingsQuery,
  selectionsQuery,
}: {
  settingsQuery: UseQueryResult<BlogSettings>;
  selectionsQuery: UseQueryResult<SelectionRow[]>;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const [layout, setLayout] = useState<BlogLayoutPreset>('HERO_GRID');
  const [heroLimit, setHeroLimit] = useState(1);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setLayout(settingsQuery.data.blogLayout);
    setHeroLimit(settingsQuery.data.blogHeroLimit);
  }, [settingsQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: () => api.patch('/cms/blog/settings', { blogLayout: layout, blogHeroLimit: heroLimit }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['blog-settings'] });
      toast.success('Layout settings saved');
    },
    onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
  });

  const patchSelectionMutation = useMutation({
    mutationFn: ({ postId, patch }: { postId: string; patch: { isHero?: boolean; sortOrder?: number } }) =>
      api.patch(`/cms/blog/selections/${postId}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['blog-selections'] }),
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  const selections = selectionsQuery.data ?? [];
  const heroCount = selections.filter((s) => s.isHero).length;
  const effectiveHeroLimit = settingsQuery.data?.blogHeroLimit ?? heroLimit;

  function toggleHero(sel: SelectionRow) {
    if (!sel.isHero && heroCount >= effectiveHeroLimit) {
      toast.error(`Hero limit reached (${effectiveHeroLimit}). Turn off another hero first or raise the limit above.`);
      return;
    }
    patchSelectionMutation.mutate({ postId: sel.postId, patch: { isHero: !sel.isHero } });
  }

  function move(idx: number, dir: -1 | 1) {
    const swap = idx + dir;
    if (swap < 0 || swap >= selections.length) return;
    const a = selections[idx];
    const b = selections[swap];
    patchSelectionMutation.mutate({ postId: a.postId, patch: { sortOrder: b.sortOrder } });
    patchSelectionMutation.mutate({ postId: b.postId, patch: { sortOrder: a.sortOrder } });
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Blog layout</CardTitle>
          <p className="text-sm text-slate-500">Choose how your school blog index page is arranged.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setLayout(p.id)}
                className={[
                  'rounded-xl border p-3 text-left transition',
                  layout === p.id ? 'border-teal-600 ring-2 ring-teal-100' : 'border-slate-200 hover:border-slate-300',
                ].join(' ')}
              >
                <LayoutMockup preset={p.id} />
                <div className="mt-2 text-sm font-semibold text-slate-800">{p.label}</div>
                <div className="text-xs text-slate-500">{p.blurb}</div>
              </button>
            ))}
          </div>

          <div className="space-y-2 max-w-xs">
            <Label hint="How many featured posts appear in the hero area (Hero + grid layout only).">Hero slots</Label>
            <Select value={String(heroLimit)} onChange={(e) => setHeroLimit(Number(e.target.value))}>
              <option value="1">1</option>
              <option value="2">2</option>
            </Select>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={() => settingsMutation.mutate()} disabled={settingsMutation.isPending}>
            {settingsMutation.isPending ? 'Saving…' : 'Save layout'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Posts on your blog</CardTitle>
          <p className="text-sm text-slate-500">
            Your own published posts and any selected from the global library. Mark up to {effectiveHeroLimit} as
            hero, and reorder the rest.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {selectionsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {selectionsQuery.error && <p className="text-sm text-rose-600">{(selectionsQuery.error as Error).message}</p>}
          {selections.length === 0 && !selectionsQuery.isLoading && (
            <p className="text-sm text-slate-400">
              Nothing on your blog yet — publish a post or select one from the Global Library tab.
            </p>
          )}
          {selections.map((sel, i) => (
            <div key={sel.postId} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{sel.post.title}</p>
                <p className="truncate text-xs text-slate-500">
                  {sel.post.isOwn ? 'Your post' : sel.post.authorName ? `By ${sel.post.authorName}` : 'Network post'}
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={sel.isHero}
                  disabled={patchSelectionMutation.isPending || (!sel.isHero && heroCount >= effectiveHeroLimit)}
                  onChange={() => toggleHero(sel)}
                  className="h-4 w-4 accent-teal-700"
                />
                <Star className={sel.isHero ? 'h-3.5 w-3.5 fill-amber-400 text-amber-400' : 'h-3.5 w-3.5 text-slate-400'} />
                Hero
              </label>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" disabled={i === 0 || patchSelectionMutation.isPending} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={i === selections.length - 1 || patchSelectionMutation.isPending}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
