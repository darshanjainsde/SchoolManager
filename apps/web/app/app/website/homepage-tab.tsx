'use client';
import ImageUploader from './image-uploader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { HOMEPAGE_SECTIONS } from './types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import type { SiteForm } from './site-form';

export default function HomepageTab({ form, onGoToDesign }: { form: SiteForm; onGoToDesign: () => void }) {
  const {
    data,
    headline,
    setHeadline,
    subheadline,
    setSubheadline,
    stats,
    addStat,
    removeStat,
    updateStat,
    heroPreviewUrl,
    isUploadingHero,
    uploadHero,
    sectionToggleMutation,
    homepageMutation,
  } = form;

  return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Homepage content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="headline">Headline</Label>
            <Input
              id="headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Where curious minds grow into confident leaders"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subheadline">Subheadline</Label>
            <Input
              id="subheadline"
              value={subheadline}
              onChange={(e) => setSubheadline(e.target.value)}
              placeholder="A brief supporting sentence…"
            />
          </div>

          {/* Hero image upload */}
          <ImageUploader
            label="Hero / landing background image"
            hint="Wide landscape photo (e.g. your school building). Max 4 MB."
            previewUrl={heroPreviewUrl}
            hasExistingAsset={!!data?.homepage.heroAssetId}
            isUploading={isUploadingHero}
            onFile={uploadHero}
          />
          <button
            type="button"
            onClick={onGoToDesign}
            className="block w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300"
          >
            <span className="block text-sm font-medium text-slate-800">
              Want this photo to fill the whole first screen — or a mosaic, slideshow, collage…?
            </span>
            <span className="block text-xs text-slate-500">
              First-screen layouts, more image slots and overlay controls now live in the{' '}
              <span className="font-semibold text-teal-700">Design</span> tab →
            </span>
          </button>

          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-sm font-medium text-slate-800">Sections on the homepage</p>
            <p className="text-xs text-slate-500">
              Untick a section to keep the homepage shorter — visitors still get its full details on
              the dedicated page (linked from the navbar). Saves immediately.
            </p>
            {HOMEPAGE_SECTIONS.map((s) => (
              <label key={s.key} className="flex items-start gap-3 rounded-md bg-slate-50 border border-slate-200 p-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={data?.homepage[s.key] ?? true}
                  disabled={sectionToggleMutation.isPending}
                  onChange={(e) => sectionToggleMutation.mutate({ [s.key]: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-emerald-700"
                />
                <span>
                  <span className="block text-sm text-slate-800">{s.label}</span>
                  <span className="block text-xs text-slate-500">{s.detail}</span>
                </span>
              </label>
            ))}
          </div>

          {/* Stats editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Key stats (e.g. "500+ Students")</Label>
              <Button variant="outline" size="sm" onClick={addStat}>
                <Plus className="h-4 w-4" />
                Add stat
              </Button>
            </div>
            {stats.length === 0 && (
              <p className="text-sm text-slate-400">No stats yet. Add one above.</p>
            )}
            {stats.map((stat, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={stat.value}
                  onChange={(e) => updateStat(idx, 'value', e.target.value)}
                  placeholder="500+"
                  className="w-24 shrink-0 font-mono"
                />
                <Input
                  value={stat.label}
                  onChange={(e) => updateStat(idx, 'label', e.target.value)}
                  placeholder="Students"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeStat(idx)}
                  className="shrink-0 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={() => homepageMutation.mutate()}
            disabled={homepageMutation.isPending}
          >
            {homepageMutation.isPending ? 'Saving…' : 'Save homepage'}
          </Button>
        </CardFooter>
      </Card>
  );
}
