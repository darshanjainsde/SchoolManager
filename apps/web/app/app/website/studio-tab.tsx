'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Monitor, Smartphone, RotateCw } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SCROLL_FEELS,
  NAV_DROPDOWN_ANIMS,
  HERO_MEDIA_OPTIONS,
  SECTION_KEYS,
  SECTION_VARIANT_DEFS,
  FESTIVALS,
  FOOTER_LAYOUTS,
  FOOTER_COLORS,
  normalizeFooterConfig,
  normalizeFestiveTheme,
  normalizeSectionVariants,
  type SectionKey,
} from '@/components/public/site-variants';

/**
 * THE STUDIO: every look-and-motion control against a LIVE preview.
 *
 * The preview iframe is /preview — the real PublicSite fed the real payload —
 * and edits reach it by postMessage, so nothing an admin tries here touches
 * the live site until they press Publish. That is the whole difference from
 * the Design tab's instant-save model, and why this tab exists.
 *
 * Responsive contract: ≥lg the rail and canvas sit side by side; below lg an
 * Edit/Preview toggle swaps them full-width (the portal chrome already gives
 * the sidebar a drawer on mobile).
 */

// ── The design subset a look carries (mirror of the api's design-config.ts;
//    the api re-whitelists on every write, so drift fails safe). ──
const DESIGN_KEYS = [
  'brandColorPrimary', 'brandColorSecondary', 'headingFont', 'animationLevel', 'themePreset',
  'heroLayout', 'heroTextAlign', 'heroOverlayStyle', 'heroOverlayOpacity', 'heroHeight',
  'headlineAccent', 'sectionShape', 'motionGesture', 'backgroundTexture',
  'navStyle', 'navColor', 'navTextColor', 'navLoginStyle',
  'scrollFeel', 'navDropdownAnim', 'heroMedia', 'heroVideoUrl',
  'sectionVariants', 'festiveTheme', 'footerConfig',
] as const;

type Look = Record<string, unknown>;

interface SiteContent {
  profile: Record<string, unknown> | null;
}
interface DesignDraft {
  id: string;
  name: string;
  config: Record<string, unknown>;
  publishAt: string | null;
  revertAt: string | null;
  updatedAt: string;
}
interface SchoolPage {
  id: string;
  slug: string;
  title: string;
  blocks: unknown[];
  published: boolean;
}
interface MediaAsset {
  id: string;
  url: string;
}

function pickLook(profile: Record<string, unknown> | null | undefined): Look {
  const out: Look = {};
  if (!profile) return out;
  for (const key of DESIGN_KEYS) {
    if (profile[key] !== undefined) out[key] = profile[key];
  }
  return out;
}

type Block =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string }
  | { t: 'img'; url: string; caption?: string | null }
  | { t: 'imgtext'; url: string | null; text: string }
  | { t: 'cta'; label: string; href?: string | null };

const BLOCK_NAMES: Record<Block['t'], string> = {
  h: 'Heading', p: 'Text', img: 'Image', imgtext: 'Image & text', cta: 'Button',
};

// ── Small control primitives (portal-styled, keyboardable) ──
function Chips<T extends string>({
  options,
  value,
  onPick,
}: {
  options: readonly { value: T; label: string; hint?: string }[];
  value: string | null | undefined;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.hint}
          onClick={() => onPick(o.value)}
          aria-pressed={value === o.value}
          className={[
            'sk-press rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
            value === o.value
              ? 'border-teal-600 bg-teal-50 text-teal-700'
              : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-600">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-teal-600" />
    </label>
  );
}

export default function StudioTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['site-content'],
    queryFn: () => api.get<SiteContent>('/site/content'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const drafts = useQuery({
    queryKey: ['design-drafts'],
    queryFn: () => api.get<DesignDraft[]>('/site/design-drafts'),
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const pages = useQuery({
    queryKey: ['school-pages'],
    queryFn: () => api.get<SchoolPage[]>('/site/pages'),
    refetchOnWindowFocus: false,
    enabled: !!host,
  });
  const galleryMedia = useQuery({
    queryKey: ['site-media-gallery'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=GALLERY'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const profile = data?.profile ?? null;
  const savedLook = useMemo(() => pickLook(profile), [profile]);

  // The look under edit. null = "seed me from the profile when it arrives".
  const [look, setLookState] = useState<Look | null>(null);
  useEffect(() => {
    if (profile && look === null) setLookState(pickLook(profile));
  }, [profile, look]);
  const current: Look = look ?? savedLook;
  const dirty = look !== null && JSON.stringify(look) !== JSON.stringify(savedLook);
  const setLook = useCallback((patch: Look) => {
    setLookState((prev) => ({ ...(prev ?? savedLook), ...patch }));
  }, [savedLook]);

  // Custom code is separate from the look (it is content-adjacent and saves
  // through its own Apply buttons) but still previews live.
  const [cssSection, setCssSection] = useState<string>('stats');
  const [cssDrafts, setCssDrafts] = useState<Record<string, string>>({});
  const [htmlDraft, setHtmlDraft] = useState<string>('');
  const [codeSeeded, setCodeSeeded] = useState(false);
  useEffect(() => {
    if (!profile || codeSeeded) return;
    const stored = (profile.customSectionCss ?? {}) as Record<string, string>;
    setCssDrafts(typeof stored === 'object' && stored ? { ...stored } : {});
    setHtmlDraft(typeof profile.customHtmlBlock === 'string' ? profile.customHtmlBlock : '');
    setCodeSeeded(true);
  }, [profile, codeSeeded]);

  // ── Live preview plumbing ──
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const postPreview = useCallback(() => {
    const overrides = {
      ...current,
      customSectionCss: cssDrafts,
      customHtmlBlock: htmlDraft,
    };
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'sk-studio-preview', overrides },
      window.location.origin,
    );
  }, [current, cssDrafts, htmlDraft]);
  useEffect(() => {
    postPreview();
  }, [postPreview]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string } | null)?.type === 'sk-studio-ready') postPreview();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postPreview]);

  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit');
  const reloadPreview = () => {
    const f = iframeRef.current;
    if (f) f.src = '/preview';
  };

  // ── Mutations ──
  const publishMutation = useMutation({
    mutationFn: () => api.put('/site/profile', current),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      setLookState(null);
      toast.success('Published — visitors now see this look');
    },
    onError: (err: Error) => toast.error(`Publish failed: ${err.message}`),
  });

  const [draftName, setDraftName] = useState('');
  const saveDraftMutation = useMutation({
    mutationFn: () =>
      api.request('/site/design-drafts', {
        method: 'POST',
        body: JSON.stringify({ name: draftName.trim() || 'Untitled look', config: current }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      setDraftName('');
      void queryClient.invalidateQueries({ queryKey: ['design-drafts'] });
      toast.success('Look saved as a draft');
    },
    onError: (err: Error) => toast.error(`Could not save the draft: ${err.message}`),
  });
  const draftOp = useMutation({
    mutationFn: ({ id, op, body }: { id: string; op: 'publish' | 'delete' | 'schedule'; body?: unknown }) => {
      if (op === 'publish') return api.request(`/site/design-drafts/${id}/publish`, { method: 'POST' });
      if (op === 'delete') return api.request(`/site/design-drafts/${id}`, { method: 'DELETE' });
      return api.request(`/site/design-drafts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: (_d, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['design-drafts'] });
      if (vars.op === 'publish') {
        void queryClient.invalidateQueries({ queryKey: ['site-content'] });
        setLookState(null);
        toast.success('Draft published — it is the live look now');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const codeMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.put('/site/profile', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Custom code saved (sanitized server-side)');
    },
    onError: (err: Error) => toast.error(`Could not save: ${err.message}`),
  });

  // ── Pages editor ──
  const [editingPage, setEditingPage] = useState<{ id: string | null; title: string; blocks: Block[]; published: boolean } | null>(null);
  const pageMutation = useMutation({
    mutationFn: (p: { id: string | null; title: string; blocks: Block[]; published: boolean }) =>
      p.id
        ? api.request(`/site/pages/${p.id}`, {
            method: 'PUT',
            body: JSON.stringify({ title: p.title, blocks: p.blocks, published: p.published }),
            headers: { 'Content-Type': 'application/json' },
          })
        : api.request('/site/pages', {
            method: 'POST',
            body: JSON.stringify({ title: p.title, blocks: p.blocks, published: p.published }),
            headers: { 'Content-Type': 'application/json' },
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['school-pages'] });
      setEditingPage(null);
      toast.success('Page saved — it appears in your menu and at its /p/ address');
    },
    onError: (err: Error) => toast.error(`Could not save the page: ${err.message}`),
  });
  const pageDelete = useMutation({
    mutationFn: (id: string) => api.request(`/site/pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['school-pages'] });
      toast.success('Page removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const festive = normalizeFestiveTheme(current.festiveTheme);
  const festiveDef = festive ? FESTIVALS.find((f) => f.value === festive.festival) : null;
  const footer = normalizeFooterConfig(current.footerConfig);
  const variants = normalizeSectionVariants(current.sectionVariants);
  const setVariant = (key: SectionKey, patch: { layout?: string; gesture?: string }) => {
    setLook({ sectionVariants: { ...variants, [key]: { ...(variants[key] ?? {}), ...patch } } });
  };

  const editBlock = (i: number, patch: Partial<Block>) => {
    setEditingPage((p) =>
      p ? { ...p, blocks: p.blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)) } : p,
    );
  };
  const moveBlock = (i: number, dir: -1 | 1) => {
    setEditingPage((p) => {
      if (!p) return p;
      const next = [...p.blocks];
      const j = i + dir;
      if (j < 0 || j >= next.length) return p;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...p, blocks: next };
    });
  };

  const rail = (
    <div className="flex flex-col gap-4">
      {/* ── Go live ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span>Your look</span>
            <span
              className={[
                'rounded-full border px-2.5 py-0.5 text-[11px] font-bold',
                dirty ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-400',
              ].join(' ')}
            >
              {dirty ? '● Unpublished changes' : '✓ Matches live'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            Everything below previews instantly on the right and touches your live site only when you publish.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => publishMutation.mutate()} disabled={!dirty || publishMutation.isPending}>
              {publishMutation.isPending ? 'Publishing…' : 'Publish changes'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setLookState(pickLook(profile))} disabled={!dirty}>
              Discard
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Diwali Edition ✨"
              maxLength={80}
              className="h-9 text-sm"
            />
            <Button size="sm" variant="outline" onClick={() => saveDraftMutation.mutate()} disabled={saveDraftMutation.isPending}>
              Save draft
            </Button>
          </div>
          {(drafts.data ?? []).length > 0 && (
            <ul className="flex flex-col gap-2">
              {(drafts.data ?? []).map((d) => (
                <li key={d.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 truncate text-sm font-semibold text-slate-700">{d.name}</span>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                      onClick={() => { setLookState({ ...savedLook, ...pickLook(d.config) }); toast.success(`Previewing “${d.name}” — publish to make it live`); }}>
                      Preview
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                      onClick={() => draftOp.mutate({ id: d.id, op: 'publish' })}>
                      Publish now
                    </Button>
                    <button type="button" aria-label={`Delete ${d.name}`} className="text-xs text-rose-500 hover:text-rose-700"
                      onClick={() => draftOp.mutate({ id: d.id, op: 'delete' })}>
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>📅 Auto-publish</span>
                    <input
                      type="date"
                      defaultValue={d.publishAt ? d.publishAt.slice(0, 10) : ''}
                      aria-label={`Publish date for ${d.name}`}
                      className="rounded border border-slate-200 px-1.5 py-0.5"
                      onChange={(e) =>
                        draftOp.mutate({
                          id: d.id, op: 'schedule',
                          body: { name: d.name, config: d.config, publishAt: e.target.value || null, revertAt: d.revertAt },
                        })
                      }
                    />
                    <span>revert</span>
                    <input
                      type="date"
                      defaultValue={d.revertAt ? d.revertAt.slice(0, 10) : ''}
                      aria-label={`Revert date for ${d.name}`}
                      className="rounded border border-slate-200 px-1.5 py-0.5"
                      onChange={(e) =>
                        draftOp.mutate({
                          id: d.id, op: 'schedule',
                          body: { name: d.name, config: d.config, publishAt: d.publishAt, revertAt: e.target.value || null },
                        })
                      }
                    />
                    {d.publishAt && (
                      <span className="basis-full text-slate-400">
                        Applies itself through that window and reverts after — no clicks needed.
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Scroll feel ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Scroll feel</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {SCROLL_FEELS.map((o) => (
            <button key={o.value} type="button" onClick={() => setLook({ scrollFeel: o.value })}
              aria-pressed={(current.scrollFeel ?? 'CLASSIC') === o.value}
              className={[
                'sk-press rounded-lg border px-3 py-2 text-left transition-colors',
                (current.scrollFeel ?? 'CLASSIC') === o.value ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300',
              ].join(' ')}
            >
              <span className="block text-sm font-semibold text-slate-700">{o.label}</span>
              <span className="block text-xs text-slate-500">{o.hint}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* ── First screen extras ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">First screen media</CardTitle>
          <p className="text-xs text-slate-500">Layout, images and overlays stay in the Design tab — this adds what plays behind them.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Chips options={HERO_MEDIA_OPTIONS} value={(current.heroMedia as string) ?? 'IMAGE'}
            onPick={(v) => setLook({ heroMedia: v })} />
          {current.heroMedia === 'VIDEO' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="studio-video-url" className="text-xs">Video URL (mp4/webm)</Label>
              <Input id="studio-video-url" value={(current.heroVideoUrl as string) ?? ''} placeholder="https://…/campus.mp4"
                onChange={(e) => setLook({ heroVideoUrl: e.target.value })} className="h-9 text-sm" />
              <p className="text-[11px] text-slate-400">
                Plays muted on loop. Your first photo slot stays the poster and the fallback on slow
                connections and for reduced-motion visitors.
              </p>
            </div>
          )}
          <div>
            <Label className="text-xs">Menu open animation</Label>
            <div className="mt-1.5"><Chips options={NAV_DROPDOWN_ANIMS} value={(current.navDropdownAnim as string) ?? 'FADE'}
              onPick={(v) => setLook({ navDropdownAnim: v })} /></div>
          </div>
        </CardContent>
      </Card>

      {/* ── Per-section variants ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sections</CardTitle>
          <p className="text-xs text-slate-500">Each band gets its own arrangement and its own entrance.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {SECTION_KEYS.map((key) => {
            const def = SECTION_VARIANT_DEFS[key];
            return (
              <div key={key} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <div className="text-sm font-semibold text-slate-700">{def.label}</div>
                <div className="mt-1.5"><Chips options={def.layouts as { value: string; label: string; hint?: string }[]}
                  value={variants[key]?.layout ?? def.layouts[0].value}
                  onPick={(v) => setVariant(key, { layout: v })} /></div>
                <div className="mt-1.5"><Chips
                  options={[
                    { value: 'DEFAULT', label: 'Page default' },
                    { value: 'RISE', label: 'Rise' },
                    { value: 'FADE', label: 'Fade' },
                    { value: 'DRAW', label: 'Draw' },
                  ]}
                  value={variants[key]?.gesture ?? 'DEFAULT'}
                  onPick={(v) => setVariant(key, { gesture: v })} /></div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Festive mode ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Festive mode</CardTitle>
          <p className="text-xs text-slate-500">
            A decoration layer over your design — like a seasonal doodle. Full takeover retints the
            whole site for the festival. Save it as a dated draft and it applies and reverts itself.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Chips
            options={[{ value: 'NONE', label: 'None' }, ...FESTIVALS.map((f) => ({ value: f.value, label: `${f.emoji} ${f.label}` }))]}
            value={festive?.festival ?? 'NONE'}
            onPick={(v) =>
              setLook({
                festiveTheme:
                  v === 'NONE'
                    ? null
                    : { festival: v, variant: FESTIVALS.find((f) => f.value === v)?.variants[0].value, intensity: 'LAYER', ribbon: true, recolor: true },
              })
            }
          />
          {festive && festiveDef && (
            <>
              <div>
                <Label className="text-xs">Decorations</Label>
                <div className="mt-1.5"><Chips options={festiveDef.variants as { value: string; label: string; hint?: string }[]}
                  value={festive.variant}
                  onPick={(v) => setLook({ festiveTheme: { ...festive, variant: v } })} /></div>
              </div>
              <div>
                <Label className="text-xs">Intensity</Label>
                <div className="mt-1.5"><Chips
                  options={[
                    { value: 'LAYER', label: 'Decorations layer' },
                    { value: 'FULL', label: 'Full festive takeover' },
                  ]}
                  value={festive.intensity}
                  onPick={(v) => setLook({ festiveTheme: { ...festive, intensity: v } })} /></div>
              </div>
              <Toggle checked={festive.ribbon} onChange={(v) => setLook({ festiveTheme: { ...festive, ribbon: v } })}
                label="Greeting ribbon above the navbar" />
              {festive.intensity === 'LAYER' && (
                <Toggle checked={festive.recolor} onChange={(v) => setLook({ festiveTheme: { ...festive, recolor: v } })}
                  label="Festive accent colour" />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Footer ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Footer</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label className="text-xs">Layout</Label>
            <div className="mt-1.5"><Chips options={FOOTER_LAYOUTS} value={footer.layout}
              onPick={(v) => setLook({ footerConfig: { ...footer, layout: v } })} /></div>
          </div>
          <div>
            <Label className="text-xs">Colour</Label>
            <div className="mt-1.5"><Chips options={FOOTER_COLORS} value={footer.color}
              onPick={(v) => setLook({ footerConfig: { ...footer, color: v } })} /></div>
          </div>
          <Toggle checked={footer.social} onChange={(v) => setLook({ footerConfig: { ...footer, social: v } })}
            label="Show social icons (from Contact & address)" />
          <Toggle checked={footer.contact} onChange={(v) => setLook({ footerConfig: { ...footer, contact: v } })}
            label="Show contact details" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="studio-tagline" className="text-xs">Tagline</Label>
            <Input id="studio-tagline" value={footer.tagline ?? ''} maxLength={160}
              placeholder="Nurturing confident, compassionate lifelong learners."
              onChange={(e) => setLook({ footerConfig: { ...footer, tagline: e.target.value || null } })}
              className="h-9 text-sm" />
          </div>
        </CardContent>
      </Card>

      {/* ── Custom pages ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Custom pages</CardTitle>
          <p className="text-xs text-slate-500">
            Need one more page — Transport, Scholarships, Alumni? Build it from simple blocks. It joins
            your menu automatically; arrange where it sits in the Menu tab.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {(pages.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5">
              <span className="flex-1 text-sm font-semibold text-slate-700">{p.title}</span>
              <span className="text-[11px] text-slate-400">/p/{p.slug}</span>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                onClick={() => setEditingPage({ id: p.id, title: p.title, blocks: (p.blocks ?? []) as Block[], published: p.published })}>
                Edit
              </Button>
              <button type="button" aria-label={`Delete ${p.title}`} className="text-xs text-rose-500 hover:text-rose-700"
                onClick={() => pageDelete.mutate(p.id)}>
                ✕
              </button>
            </div>
          ))}
          {!editingPage && (
            <Button size="sm" variant="outline"
              onClick={() => setEditingPage({ id: null, title: '', blocks: [{ t: 'h', text: '' }, { t: 'p', text: '' }], published: true })}>
              + New page
            </Button>
          )}
          {editingPage && (
            <div className="flex flex-col gap-2.5 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="studio-page-title" className="text-xs">Page title (its address is fixed when first saved)</Label>
                <Input id="studio-page-title" value={editingPage.title} maxLength={120} placeholder="Scholarships"
                  onChange={(e) => setEditingPage({ ...editingPage, title: e.target.value })} className="h-9 bg-white text-sm" />
              </div>
              {editingPage.blocks.map((b, i) => (
                <div key={i} className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="flex items-center gap-1">
                    <span className="flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{BLOCK_NAMES[b.t]}</span>
                    <button type="button" aria-label="Move up" disabled={i === 0} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveBlock(i, -1)}>▲</button>
                    <button type="button" aria-label="Move down" disabled={i === editingPage.blocks.length - 1} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveBlock(i, 1)}>▼</button>
                    <button type="button" aria-label="Remove block" className="px-1 text-xs text-rose-400 hover:text-rose-600"
                      onClick={() => setEditingPage({ ...editingPage, blocks: editingPage.blocks.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                  {(b.t === 'h' || b.t === 'cta') && (
                    <Input value={b.t === 'h' ? b.text : b.label} maxLength={b.t === 'h' ? 200 : 80}
                      placeholder={b.t === 'h' ? 'Heading' : 'Button label'}
                      onChange={(e) => editBlock(i, b.t === 'h' ? { text: e.target.value } : { label: e.target.value })}
                      className="mt-1 h-8 text-sm" />
                  )}
                  {(b.t === 'p' || b.t === 'imgtext') && (
                    <Textarea value={b.text} rows={2} placeholder="Write something…"
                      onChange={(e) => editBlock(i, { text: e.target.value })} className="mt-1 text-sm" />
                  )}
                  {(b.t === 'img' || b.t === 'imgtext') && (
                    <div className="mt-1 flex gap-1.5">
                      <Input value={b.url ?? ''} placeholder="https://… image URL"
                        onChange={(e) => editBlock(i, { url: e.target.value })} className="h-8 flex-1 text-xs" />
                      {(galleryMedia.data ?? []).length > 0 && (
                        <select aria-label="Use a gallery photo" className="h-8 rounded-md border border-slate-200 text-xs text-slate-500"
                          value="" onChange={(e) => e.target.value && editBlock(i, { url: e.target.value })}>
                          <option value="">Gallery…</option>
                          {(galleryMedia.data ?? []).map((m, j) => (
                            <option key={m.id} value={m.url}>Photo {j + 1}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(BLOCK_NAMES) as Block['t'][]).map((t) => (
                  <button key={t} type="button" className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                    onClick={() =>
                      setEditingPage({
                        ...editingPage,
                        blocks: [
                          ...editingPage.blocks,
                          t === 'h' ? { t, text: '' } : t === 'p' ? { t, text: '' }
                            : t === 'img' ? { t, url: '' } : t === 'imgtext' ? { t, url: null, text: '' }
                            : { t, label: 'Learn more' },
                        ],
                      })
                    }>
                    + {BLOCK_NAMES[t]}
                  </button>
                ))}
              </div>
              <Toggle checked={editingPage.published} onChange={(v) => setEditingPage({ ...editingPage, published: v })} label="Published (visible on your site)" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => pageMutation.mutate(editingPage)}
                  disabled={!editingPage.title.trim() || pageMutation.isPending}>
                  {pageMutation.isPending ? 'Saving…' : 'Save page'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingPage(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Custom code ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Custom code</CardTitle>
          <p className="text-xs text-slate-500">
            The escape hatch for one-school requests: paste CSS scoped to one section, or an HTML
            block shown before the footer. Both are sanitized on save — no scripts, no external
            fetches — and preview live before you save.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="studio-css-section" className="text-xs">Section</Label>
            <select id="studio-css-section" value={cssSection} onChange={(e) => setCssSection(e.target.value)}
              className="h-8 rounded-md border border-slate-200 text-xs text-slate-600">
              {['hero', ...SECTION_KEYS, 'footer', 'page'].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <Textarea value={cssDrafts[cssSection] ?? ''} rows={5} spellCheck={false}
            placeholder={'.ps-panel { border: 2px dashed gold; }\n@keyframes spinIn { … }'}
            onChange={(e) => setCssDrafts({ ...cssDrafts, [cssSection]: e.target.value })}
            className="font-mono text-xs" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline"
              onClick={() => codeMutation.mutate({ customSectionCss: cssDrafts })}
              disabled={codeMutation.isPending}>
              Save section CSS
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="studio-html" className="text-xs">HTML block (before the footer)</Label>
            <Textarea id="studio-html" value={htmlDraft} rows={4} spellCheck={false}
              placeholder='<div class="ps-panel" style="padding:1.5rem"><h2 class="ps-head">Our toppers</h2>…</div>'
              onChange={(e) => setHtmlDraft(e.target.value)} className="font-mono text-xs" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline"
                onClick={() => codeMutation.mutate({ customHtmlBlock: htmlDraft })}
                disabled={codeMutation.isPending}>
                Save HTML block
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const preview = (
    <div className="lg:sticky lg:top-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          <button type="button" aria-label="Desktop preview" aria-pressed={device === 'desktop'}
            onClick={() => setDevice('desktop')}
            className={`px-2.5 py-1.5 ${device === 'desktop' ? 'bg-teal-50 text-teal-700' : 'text-slate-400'}`}>
            <Monitor className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Mobile preview" aria-pressed={device === 'mobile'}
            onClick={() => setDevice('mobile')}
            className={`px-2.5 py-1.5 ${device === 'mobile' ? 'bg-teal-50 text-teal-700' : 'text-slate-400'}`}>
            <Smartphone className="h-4 w-4" />
          </button>
        </div>
        <button type="button" onClick={reloadPreview}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">
          <RotateCw className="h-3.5 w-3.5" /> Reload
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-emerald-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> LIVE PREVIEW
        </span>
      </div>
      <div className={device === 'mobile' ? 'mx-auto w-[390px] max-w-full' : ''}>
        <iframe
          ref={iframeRef}
          src="/preview"
          title="Live preview of your website"
          className="h-[70vh] min-h-[480px] w-full rounded-xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100vh-11rem)]"
        />
      </div>
    </div>
  );

  return (
    <div>
      {/* Mobile/tablet: one pane at a time, swapped by this toggle. */}
      <div className="sticky top-0 z-10 -mx-1 mb-3 flex gap-1 rounded-lg bg-white/90 p-1 shadow-sm backdrop-blur lg:hidden">
        {(['edit', 'preview'] as const).map((p) => (
          <button key={p} type="button" aria-pressed={mobilePane === p}
            onClick={() => setMobilePane(p)}
            className={[
              'flex-1 rounded-md px-3 py-2 text-sm font-semibold capitalize',
              mobilePane === p ? 'bg-teal-600 text-white' : 'text-slate-500',
            ].join(' ')}
          >
            {p === 'edit' ? 'Edit' : 'Preview'}
          </button>
        ))}
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] lg:gap-6">
        <div className={mobilePane === 'preview' ? 'hidden lg:block' : ''}>{rail}</div>
        <div className={`mt-4 lg:mt-0 ${mobilePane === 'edit' ? 'hidden lg:block' : ''}`}>{preview}</div>
      </div>
    </div>
  );
}
