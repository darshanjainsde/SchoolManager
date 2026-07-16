'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Upload, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Local types (web cannot import API types) ────────────────────────────────
interface SiteProfile {
  heroLayout?: string | null;
  heroTextAlign?: string | null;
  heroOverlayStyle?: string | null;
  heroOverlayOpacity?: number | null;
  heroHeight?: string | null;
  headlineAccent?: string | null;
  navStyle?: string | null;
  navCtaLabel?: string | null;
  navShowCta?: boolean | null;
  phone?: string | null;
  email?: string | null;
}
interface SiteContent {
  profile: SiteProfile;
  homepage: { heroImageAssetIds?: string[] | null };
}
interface MediaAsset {
  id: string;
  url: string;
}

// ── Option catalogues ────────────────────────────────────────────────────────
const LAYOUTS: { value: string; label: string; slots: number; note: string }[] = [
  { value: 'ILLUSTRATION', label: 'Illustrated', slots: 1, note: 'The friendly animated-cards hero. Works with 0 images; one photo fills the Open Day card.' },
  { value: 'FULL_BLEED', label: 'Full canvas', slots: 1, note: 'One wide photo fills the whole landing screen behind your headline.' },
  { value: 'SPLIT_MOSAIC', label: 'Mosaic 1+2', slots: 3, note: 'Big photo left with the headline on it, two smaller photos stacked right.' },
  { value: 'SPLIT_EDITORIAL', label: 'Editorial split', slots: 1, note: 'Headline on calm paper, one tall photo beside it.' },
  { value: 'COLLAGE', label: 'Collage band', slots: 4, note: 'Centered headline over a band of 3–4 photos.' },
  { value: 'SLIDESHOW', label: 'Slideshow', slots: 5, note: '3–5 photos slowly crossfade behind the headline.' },
  { value: 'MINIMAL', label: 'Minimal type', slots: 0, note: 'Pure typography — no images, minimal motion.' },
];

const ACCENTS: { value: string; label: string; hint: string }[] = [
  { value: 'DRAW', label: 'Hand-drawn underline', hint: 'The stroke draws itself under the name (current)' },
  { value: 'MARKER', label: 'Highlighter sweep', hint: 'Accent wash sweeps behind the headline' },
  { value: 'GROW', label: 'Accent bar', hint: 'A solid bar grows in from the left' },
  { value: 'NONE', label: 'None', hint: 'No accent under the headline' },
];

const NAVS: { value: string; label: string; hint: string }[] = [
  { value: 'CLASSIC', label: 'Classic', hint: 'Logo left, links right (current)' },
  { value: 'CENTER', label: 'Centered crest', hint: 'Links split around a centered logo' },
  { value: 'PILL', label: 'Floating pill', hint: 'Detached rounded bar over the page' },
  { value: 'STRIP', label: 'Info strip', hint: 'Phone & email ribbon above the bar' },
  { value: 'GHOST', label: 'Transparent', hint: 'Invisible over a photo hero, solid on scroll' },
];

// ── Mini wireframes for the layout picker ────────────────────────────────────
function LayoutWire({ v }: { v: string }) {
  const ph = 'rounded-[3px] bg-gradient-to-br from-emerald-300 to-emerald-700';
  const bar = 'rounded-sm bg-slate-300';
  return (
    <div className="relative h-14 w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-1">
      {v === 'ILLUSTRATION' && (
        <div className="flex h-full gap-1">
          <div className="flex w-1/2 flex-col justify-center gap-1 p-1">
            <div className={`${bar} h-1.5 w-11/12`} />
            <div className={`${bar} h-1.5 w-7/12`} />
          </div>
          <div className="relative w-1/2">
            <div className="absolute right-0.5 top-0.5 h-6 w-8 rounded-sm border border-slate-200 bg-white" />
            <div className="absolute bottom-1 left-1 h-4 w-7 rounded-sm border border-slate-200 bg-white" />
          </div>
        </div>
      )}
      {v === 'FULL_BLEED' && (
        <div className={`relative h-full ${ph}`}>
          <div className="absolute bottom-1.5 left-1.5 h-1.5 w-1/2 rounded-sm bg-white/90" />
        </div>
      )}
      {v === 'SPLIT_MOSAIC' && (
        <div className="grid h-full grid-cols-[1.6fr_1fr] grid-rows-2 gap-1">
          <div className={`${ph} row-span-2`} />
          <div className={ph} />
          <div className={ph} />
        </div>
      )}
      {v === 'SPLIT_EDITORIAL' && (
        <div className="grid h-full grid-cols-2 gap-1">
          <div className="flex flex-col justify-center gap-1 p-1">
            <div className={`${bar} h-1.5 w-11/12`} />
            <div className={`${bar} h-1.5 w-7/12`} />
          </div>
          <div className={ph} />
        </div>
      )}
      {v === 'COLLAGE' && (
        <div className="flex h-full flex-col gap-1">
          <div className={`${bar} mx-auto h-1.5 w-1/2`} />
          <div className="grid flex-1 grid-cols-3 gap-1">
            <div className={ph} /><div className={ph} /><div className={ph} />
          </div>
        </div>
      )}
      {v === 'SLIDESHOW' && (
        <div className="relative h-full overflow-hidden rounded-[3px] bg-gradient-to-br from-sky-300 to-sky-700">
          <div className="absolute left-1/4 top-1/2 h-1.5 w-1/2 -translate-y-1/2 rounded-sm bg-white/90" />
          <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
            <span className="h-1 w-1 rounded-full bg-amber-300" />
            <span className="h-1 w-1 rounded-full bg-white/70" />
            <span className="h-1 w-1 rounded-full bg-white/70" />
          </div>
        </div>
      )}
      {v === 'MINIMAL' && (
        <div className="grid h-full place-items-center">
          <div className={`${bar} h-2 w-2/3`} />
        </div>
      )}
    </div>
  );
}

function NavWire({ v }: { v: string }) {
  const dot = <span className="h-2 w-2 flex-none rounded-sm bg-gradient-to-br from-teal-500 to-amber-400" />;
  const link = <span className="h-1 w-3 rounded-sm bg-slate-300" />;
  const cta = <span className="ml-auto h-2 w-4 flex-none rounded-sm bg-amber-400" />;
  if (v === 'PILL')
    return (
      <div className="h-9 w-full rounded-md bg-gradient-to-br from-emerald-300 to-emerald-600 p-1">
        <div className="mx-1 flex h-4 items-center gap-1 rounded-full bg-white/90 px-1.5">{dot}{link}{link}{cta}</div>
      </div>
    );
  if (v === 'GHOST')
    return (
      <div className="flex h-9 w-full items-center gap-1 rounded-md bg-gradient-to-br from-sky-400 to-sky-700 px-1.5">
        {dot}
        <span className="h-1 w-3 rounded-sm bg-white/80" />
        <span className="h-1 w-3 rounded-sm bg-white/80" />
        {cta}
      </div>
    );
  if (v === 'STRIP')
    return (
      <div className="flex h-9 w-full flex-col gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-1">
        <div className="h-1.5 rounded-sm bg-slate-600" />
        <div className="flex flex-1 items-center gap-1 px-0.5">{dot}{link}{link}{cta}</div>
      </div>
    );
  if (v === 'CENTER')
    return (
      <div className="flex h-9 w-full items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5">
        {link}{link}{dot}{link}{link}
      </div>
    );
  return (
    <div className="flex h-9 w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5">
      {dot}{link}{link}{link}{cta}
    </div>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────
export default function DesignTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();
  const slotFileRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<number>(0);

  const { data } = useQuery({
    queryKey: ['site-content'],
    queryFn: () => api.get<SiteContent>('/site/content'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  // Resolves hero slot asset ids to URLs.
  const heroMedia = useQuery({
    queryKey: ['site-media-hero'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=HERO'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const profile = data?.profile;
  const layout = profile?.heroLayout ?? 'ILLUSTRATION';
  const layoutSpec = LAYOUTS.find((l) => l.value === layout) ?? LAYOUTS[0];
  const slotIds = data?.homepage.heroImageAssetIds ?? [];
  const urlOf = (id: string) => heroMedia.data?.find((m) => m.id === id)?.url ?? null;

  // Slider + CTA label are edited locally, saved on release/blur.
  const [opacity, setOpacity] = useState(65);
  const [ctaLabel, setCtaLabel] = useState('Enquire');
  const [isUploadingSlot, setIsUploadingSlot] = useState(false);
  useEffect(() => {
    if (!profile) return;
    setOpacity(profile.heroOverlayOpacity ?? 65);
    setCtaLabel(profile.navCtaLabel ?? 'Enquire');
  }, [profile]);

  const profileMutation = useMutation({
    mutationFn: (patch: Partial<SiteProfile>) => api.put('/site/profile', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Design updated — reload your public site to see it');
    },
    onError: (err: Error) => toast.error(`Failed to save design: ${err.message}`),
  });

  const slotsMutation = useMutation({
    mutationFn: (ids: string[]) => api.put('/site/homepage', { heroImageAssetIds: ids }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Hero images updated');
    },
    onError: (err: Error) => toast.error(`Failed to update hero images: ${err.message}`),
  });

  async function uploadToSlot(index: number, file: File) {
    setIsUploadingSlot(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=HERO', { method: 'POST', body: fd });
      const ids = [...slotIds];
      ids[index] = asset.id;
      await slotsMutation.mutateAsync(ids.filter(Boolean).slice(0, 5));
      void queryClient.invalidateQueries({ queryKey: ['site-media-hero'] });
    } catch (err) {
      toast.error(`Image upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingSlot(false);
    }
  }

  function removeSlot(index: number) {
    const ids = slotIds.filter((_, i) => i !== index);
    slotsMutation.mutate(ids);
  }

  function moveSlot(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= slotIds.length) return;
    const ids = [...slotIds];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    slotsMutation.mutate(ids);
  }

  const overlayRelevant = ['FULL_BLEED', 'SPLIT_MOSAIC', 'SLIDESHOW'].includes(layout);
  const slotCount = layoutSpec.slots;
  const busy = profileMutation.isPending || slotsMutation.isPending || isUploadingSlot;

  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Hidden shared file input for slot uploads */}
      <input
        ref={slotFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadToSlot(pendingSlotRef.current, file);
          e.target.value = '';
        }}
      />

      {/* ── First screen ── */}
      <Card>
        <CardHeader>
          <CardTitle>First screen layout</CardTitle>
          <p className="text-sm text-slate-500">
            How the top of your homepage is divided. The image slots below adapt to your choice — changes save
            immediately.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {LAYOUTS.map((l) => (
              <button
                key={l.value}
                type="button"
                disabled={busy}
                onClick={() => profileMutation.mutate({ heroLayout: l.value })}
                className={[
                  'rounded-xl border p-2 text-left transition',
                  layout === l.value
                    ? 'border-teal-600 ring-2 ring-teal-100'
                    : 'border-slate-200 hover:border-slate-300',
                ].join(' ')}
              >
                <LayoutWire v={l.value} />
                <span className="mt-1.5 block text-xs font-semibold text-slate-700">{l.label}</span>
                <span className="block text-[11px] text-slate-400">
                  {l.slots === 0 ? 'no images' : `${l.slots} image${l.slots > 1 ? 's' : ''}`}
                </span>
              </button>
            ))}
          </div>
          <p className="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-800">{layoutSpec.note}</p>

          {/* Image slots */}
          {slotCount > 0 && (
            <div className="space-y-2">
              <Label>Images for this layout</Label>
              <div className="flex flex-wrap gap-3">
                {Array.from({ length: slotCount }).map((_, i) => {
                  const id = slotIds[i];
                  const url = id ? urlOf(id) : null;
                  return (
                    <div key={i} className="w-36">
                      {id ? (
                        <div className="group relative h-24 w-36 overflow-hidden rounded-lg border border-slate-200">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={`Hero image ${i + 1}`} className="h-full w-full object-cover" />
                          ) : (
                            <div className="grid h-full w-full place-items-center bg-slate-100 text-xs text-slate-400">
                              image {i + 1}
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                            <button
                              type="button"
                              aria-label="Move image left"
                              disabled={busy || i === 0}
                              onClick={() => moveSlot(i, -1)}
                              className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-30"
                            >
                              <ArrowLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Remove image"
                              disabled={busy}
                              onClick={() => removeSlot(i)}
                              className="rounded p-0.5 text-white hover:bg-rose-500/60"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Move image right"
                              disabled={busy || i >= slotIds.length - 1}
                              onClick={() => moveSlot(i, 1)}
                              className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-30"
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || i > slotIds.length}
                          onClick={() => {
                            pendingSlotRef.current = i;
                            slotFileRef.current?.click();
                          }}
                          className="grid h-24 w-36 place-items-center rounded-lg border-2 border-dashed border-slate-300 text-xs font-medium text-slate-500 transition hover:border-slate-400 disabled:opacity-40"
                        >
                          <span className="flex items-center gap-1">
                            <Upload className="h-3.5 w-3.5" />
                            {isUploadingSlot ? 'Uploading…' : `Add image ${i + 1}`}
                          </span>
                        </button>
                      )}
                      <p className="mt-1 text-center text-[11px] text-slate-400">
                        {i === 0 ? 'main photo' : `photo ${i + 1}`}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400">
                Wide landscape photos work best. Max 4 MB each. Fill slots left to right — the first image is
                the main one.
              </p>
            </div>
          )}

          {/* Knobs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="design-align">Text alignment</Label>
              <Select
                id="design-align"
                value={profile?.heroTextAlign ?? 'LEFT'}
                disabled={busy}
                onChange={(e) => profileMutation.mutate({ heroTextAlign: e.target.value })}
              >
                <option value="LEFT">Left</option>
                <option value="CENTER">Center</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="design-overlay">Overlay on photos</Label>
              <Select
                id="design-overlay"
                value={profile?.heroOverlayStyle ?? 'WASH'}
                disabled={busy || !overlayRelevant}
                onChange={(e) => profileMutation.mutate({ heroOverlayStyle: e.target.value })}
              >
                <option value="WASH">Paper wash — dark text</option>
                <option value="TINT">Brand tint — white text</option>
                <option value="DARK">Dark cinema — white text</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="design-height">First screen height</Label>
              <Select
                id="design-height"
                value={profile?.heroHeight ?? 'FULL'}
                disabled={busy}
                onChange={(e) => profileMutation.mutate({ heroHeight: e.target.value })}
              >
                <option value="FULL">Full screen</option>
                <option value="COMPACT">Compact</option>
              </Select>
            </div>
          </div>

          {/* Opacity dial */}
          <div className={`space-y-2 ${overlayRelevant ? '' : 'opacity-50'}`}>
            <div className="flex items-center justify-between">
              <Label htmlFor="design-opacity">Overlay strength (image dimming behind text)</Label>
              <span className="text-xs font-semibold tabular-nums text-slate-600">{opacity}%</span>
            </div>
            <input
              id="design-opacity"
              type="range"
              min={10}
              max={95}
              step={5}
              value={opacity}
              disabled={!overlayRelevant}
              onChange={(e) => setOpacity(Number(e.target.value))}
              onPointerUp={() => profileMutation.mutate({ heroOverlayOpacity: opacity })}
              onKeyUp={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  profileMutation.mutate({ heroOverlayOpacity: opacity });
                }
              }}
              className="w-full accent-teal-600"
            />
            <p className="text-xs text-slate-400">
              Low = photo shows through more; high = text pops more. Applies to layouts that put text on a
              photo (full canvas, mosaic, slideshow).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Headline accent ── */}
      <Card>
        <CardHeader>
          <CardTitle>Headline accent</CardTitle>
          <p className="text-sm text-slate-500">The little animation under your school’s headline.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ACCENTS.map((a) => {
              const on = (profile?.headlineAccent ?? 'DRAW') === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  disabled={busy}
                  onClick={() => profileMutation.mutate({ headlineAccent: a.value })}
                  className={[
                    'rounded-xl border p-3 text-left transition',
                    on ? 'border-teal-600 ring-2 ring-teal-100' : 'border-slate-200 hover:border-slate-300',
                  ].join(' ')}
                >
                  <span className="block font-serif text-lg font-bold leading-tight text-slate-800">
                    {a.value === 'MARKER' ? (
                      <span className="bg-gradient-to-t from-amber-200 from-40% to-transparent to-40%">Greenfield School</span>
                    ) : (
                      'Greenfield School'
                    )}
                  </span>
                  {a.value === 'DRAW' && (
                    <svg className="mt-0.5 block" width="110" height="8" viewBox="0 0 110 8" fill="none">
                      <path d="M2 6 C 30 1, 80 1, 108 5" stroke="#d99a26" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  )}
                  {a.value === 'GROW' && <span className="mt-1.5 block h-1.5 w-16 rounded-full bg-amber-400" />}
                  <span className="mt-2 block text-xs font-semibold text-slate-700">{a.label}</span>
                  <span className="block text-[11px] text-slate-400">{a.hint}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Navbar ── */}
      <Card>
        <CardHeader>
          <CardTitle>Navbar</CardTitle>
          <p className="text-sm text-slate-500">
            Style of the site-wide navigation. Menu links stay automatic based on your enabled sections.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {NAVS.map((n) => {
              const on = (profile?.navStyle ?? 'CLASSIC') === n.value;
              return (
                <button
                  key={n.value}
                  type="button"
                  disabled={busy}
                  onClick={() => profileMutation.mutate({ navStyle: n.value })}
                  className={[
                    'rounded-xl border p-2 text-left transition',
                    on ? 'border-teal-600 ring-2 ring-teal-100' : 'border-slate-200 hover:border-slate-300',
                  ].join(' ')}
                >
                  <NavWire v={n.value} />
                  <span className="mt-1.5 block text-xs font-semibold text-slate-700">{n.label}</span>
                  <span className="block text-[11px] leading-snug text-slate-400">{n.hint}</span>
                </button>
              );
            })}
          </div>
          {(profile?.navStyle ?? 'CLASSIC') === 'GHOST' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Transparent needs a photo-based first screen (full canvas, mosaic, editorial, collage or
              slideshow). On other layouts it falls back to Classic.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="design-cta">Button text</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="design-cta"
                  value={ctaLabel}
                  maxLength={40}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="Enquire"
                  className="w-56"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !ctaLabel.trim() || ctaLabel.trim() === (profile?.navCtaLabel ?? 'Enquire')}
                  onClick={() => profileMutation.mutate({ navCtaLabel: ctaLabel.trim() })}
                >
                  Save
                </Button>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={profile?.navShowCta ?? true}
                disabled={busy}
                onChange={(e) => profileMutation.mutate({ navShowCta: e.target.checked })}
                className="h-4 w-4 accent-emerald-700"
              />
              Show the button
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
