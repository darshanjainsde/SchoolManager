'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Monitor, Smartphone, RotateCw, ChevronRight, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X, Upload, CornerLeftUp } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import ImageUploader from './image-uploader';
import { FONT_OPTIONS, MOTION_OPTIONS } from '@/lib/theme-presets';
import { START_THEMES, themeInUse, type StartTheme } from '@/lib/start-themes';
import { STYLE_PRESETS, MOTION_GESTURES, BACKGROUND_TEXTURES } from '@/components/public/site-style';
import { SECTION_SHAPES } from '@/components/public/section-shape';
import {
  SCROLL_FEELS, NAV_DROPDOWN_ANIMS, HERO_MEDIA_OPTIONS, SECTION_KEYS, SECTION_VARIANT_DEFS,
  FESTIVALS, FOOTER_LAYOUTS, FOOTER_COLORS,
  normalizeFooterConfig, normalizeFestiveTheme, normalizeSectionVariants, type SectionKey,
  ORDERABLE_HOME_SECTIONS, HOME_SECTIONS_KEY, SECTION_ORDER_KEY, HOME_SECTION_MAX,
  homeSectionsOf, sectionOrderOf, normalizeSectionOrder, normalizeHomeSections, isSafeBlockUrl,
  type HomeSection, type SectionVariants,
} from '@/components/public/site-variants';
import { defaultNavConfig, validateNavConfig, type NavConfig, type NavConfigItem } from '@/components/public/sections/nav-config';
import {
  HERO_LAYOUTS, HEADLINE_ACCENTS, HERO_ALIGN, HERO_OVERLAY, HERO_HEIGHT,
  NAV_STYLES, NAV_COLORS, NAV_TEXT, LOGIN_STYLES, OVERLAY_LAYOUTS, VIDEO_LAYOUTS, type Opt,
} from './studio-catalogues';

/**
 * THE STUDIO — the one place to design the whole website, against a live
 * preview. Everything that decides how the site LOOKS lives here: brand
 * colours, theme, the first screen, section styling, the navbar and its menu,
 * scroll feel, festive mode, the footer, custom pages and the code escape
 * hatch. Content (Homepage text, About, Courses, Gallery…) stays in its own
 * tabs — this is design, not words.
 *
 * The preview iframe is /preview — the real PublicSite fed the real payload —
 * and edits reach it by postMessage, so nothing touches the live site until
 * Publish. Assets (logo, hero photos) upload immediately because a file can't
 * be previewed before it exists; the preview reloads to pick them up.
 *
 * Layout: the preview is FROZEN on the right (its column never scrolls) while
 * the control rail scrolls on its own, and the rail's groups are collapsible
 * so every group is visible at a glance and you open only the one you want.
 */

// The design subset a saved look carries — mirror of the api's design-config.ts.
const DESIGN_KEYS = [
  'brandColorPrimary', 'brandColorSecondary', 'headingFont', 'animationLevel', 'themePreset',
  'heroLayout', 'heroTextAlign', 'heroOverlayStyle', 'heroOverlayOpacity', 'heroHeight',
  'headlineAccent', 'sectionShape', 'motionGesture', 'backgroundTexture',
  'navStyle', 'navColor', 'navTextColor', 'navLoginStyle',
  'navCtaLabel', 'navShowCta', 'navLoginLabel', 'navShowLogin', 'navConfig',
  'scrollFeel', 'navDropdownAnim', 'heroMedia', 'heroVideoUrl',
  'sectionVariants', 'festiveTheme', 'footerConfig',
] as const;

type Look = Record<string, unknown>;

interface SiteContent {
  profile: Record<string, unknown> | null;
  homepage?: { heroImageAssetIds?: string[] | null } | null;
  school?: { features?: string[] } | null;
  courses?: unknown[];
}
interface DesignDraft { id: string; name: string; config: Record<string, unknown>; publishAt: string | null; revertAt: string | null; }
interface SchoolPage { id: string; slug: string; title: string; blocks: unknown[]; published: boolean; showInNav?: boolean; }
interface MediaAsset { id: string; url: string }

function pickLook(profile: Record<string, unknown> | null | undefined): Look {
  const out: Look = {};
  if (!profile) return out;
  for (const k of DESIGN_KEYS) if (profile[k] !== undefined) out[k] = profile[k];
  return out;
}

type Block =
  | { t: 'h'; text: string } | { t: 'p'; text: string }
  | { t: 'img'; url: string; caption?: string | null }
  | { t: 'imgtext'; url: string | null; text: string }
  | { t: 'cta'; label: string; href?: string | null };
const BLOCK_NAMES: Record<Block['t'], string> = { h: 'Heading', p: 'Text', img: 'Image', imgtext: 'Image & text', cta: 'Button' };

const AVAIL_ALWAYS = ['about', 'hof', 'admissions', 'contact'];
function availablePages(c: SiteContent | undefined): string[] {
  const f = c?.school?.features ?? [];
  const has: Record<string, boolean> = {
    about: true, hof: true, admissions: true, contact: true,
    gallery: f.includes('GALLERY'), connect: f.includes('EVENTS'), blog: f.includes('BLOG'),
    academics: (c?.courses?.length ?? 0) > 0,
  };
  return Object.keys(has).filter((k) => has[k] || AVAIL_ALWAYS.includes(k));
}

// ── control primitives ──────────────────────────────────────────────────────
function Chips({ options, value, onPick }: { options: readonly Opt[]; value: string | null | undefined; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.hint} onClick={() => onPick(o.value)} aria-pressed={value === o.value}
          className={['sk-press rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
            value === o.value ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700'].join(' ')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function Stack({ options, value, onPick }: { options: readonly Opt[]; value: string | null | undefined; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onPick(o.value)} aria-pressed={value === o.value}
          className={['sk-press rounded-lg border px-3 py-2 text-left transition-colors',
            value === o.value ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'].join(' ')}>
          <span className="block text-sm font-semibold text-slate-700">{o.label}</span>
          {o.hint && <span className="block text-xs text-slate-500">{o.hint}</span>}
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
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 first:mt-0">{children}</div>;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The collapsible group. Defined at MODULE level (reading open state through a
 * context) — NOT inside the render — so it is a stable component type. A group
 * defined inside render is a new function every keystroke, which remounts the
 * whole group: that reset the rail's scroll to the top on every edit and
 * detached the logo file-input mid-pick so the chosen file never registered.
 */
const GroupCtx = createContext<{ open: Record<string, boolean>; toggle: (id: string) => void }>({ open: {}, toggle: () => {} });
function Group({ id, title, summary, children }: { id: string; title: string; summary?: string; children: React.ReactNode }) {
  const { open, toggle } = useContext(GroupCtx);
  const isOpen = !!open[id];
  return (
    <Card>
      <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} className="sk-press flex w-full items-center gap-2 px-3.5 py-3 text-left">
        <ChevronRight className={`h-4 w-4 flex-none text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-slate-800">{title}</span>
          {summary && !isOpen && <span className="block truncate text-xs text-slate-400">{summary}</span>}
        </span>
      </button>
      {isOpen && <div className="border-t border-slate-100 px-3.5 py-3">{children}</div>}
    </Card>
  );
}

/** Which section of the site each group's controls affect — the preview
 *  scrolls here when you open the group, so it follows what you're editing. */
const GROUP_FOCUS: Record<string, string> = {
  'start-theme': 'top', brand: 'top', hero: 'hero', looks: 'stats', 'sections-style': 'stats', variants: 'stats',
  nav: 'top', festive: 'top', footer: 'footer', pages: 'top', code: 'top',
};

export default function StudioTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ['site-content'], queryFn: () => api.get<SiteContent>('/site/content'), staleTime: Infinity, refetchOnWindowFocus: false, enabled: !!host });
  const drafts = useQuery({ queryKey: ['design-drafts'], queryFn: () => api.get<DesignDraft[]>('/site/design-drafts'), refetchOnWindowFocus: false, enabled: !!host });
  const pages = useQuery({ queryKey: ['school-pages'], queryFn: () => api.get<SchoolPage[]>('/site/pages'), refetchOnWindowFocus: false, enabled: !!host });
  const galleryMedia = useQuery({ queryKey: ['site-media-gallery'], queryFn: () => api.get<MediaAsset[]>('/site/media?kind=GALLERY'), staleTime: 30_000, refetchOnWindowFocus: false, enabled: !!host });
  const heroMedia = useQuery({ queryKey: ['site-media-hero'], queryFn: () => api.get<MediaAsset[]>('/site/media?kind=HERO'), staleTime: 30_000, refetchOnWindowFocus: false, enabled: !!host });

  const profile = data?.profile ?? null;
  const savedLook = useMemo(() => pickLook(profile), [profile]);
  const sig = useCallback((l: Look) => JSON.stringify(Object.entries(l).sort(([a], [b]) => a.localeCompare(b))), []);

  // ── Theme manager ──
  // You edit ONE theme at a time — the Live site or a saved draft. Its id is
  // editingId. In-progress edits live in `working[id]`, kept per theme so
  // switching never loses anything; Save/Publish is what persists them.
  const [editingId, setEditingId] = useState<string>('live');
  const [working, setWorking] = useState<Record<string, Look>>({});
  const draftsById = useMemo(
    () => Object.fromEntries((drafts.data ?? []).map((d) => [d.id, d])),
    [drafts.data],
  );
  // Fall back to Live if the edited draft was deleted elsewhere.
  const activeId = editingId !== 'live' && drafts.data && !draftsById[editingId] ? 'live' : editingId;
  const baseLook = useCallback(
    (id: string): Look => (id === 'live' ? savedLook : pickLook((draftsById[id]?.config ?? {}) as Record<string, unknown>)),
    [savedLook, draftsById],
  );
  const base = baseLook(activeId);
  const current: Look = working[activeId] ?? base;
  const dirty = !!working[activeId] && sig(working[activeId]) !== sig(base);
  const setLook = useCallback(
    (patch: Look) => setWorking((w) => ({ ...w, [activeId]: { ...(w[activeId] ?? base), ...patch } })),
    [activeId, base],
  );
  const clearWorking = useCallback(
    (id: string) => setWorking((w) => { const n = { ...w }; delete n[id]; return n; }),
    [],
  );
  const editingName = activeId === 'live' ? 'Live site' : (draftsById[activeId]?.name ?? 'Draft');
  const [showSchedule, setShowSchedule] = useState(false);

  // Menu arrangement lives in the look (live-previews + publishes with it),
  // gated by the same validator the standalone editor used.
  const navConfig = (current.navConfig as NavConfig | null | undefined) ?? defaultNavConfig();
  const availPages = useMemo(() => availablePages(data), [data]);
  const navCheck = useMemo(() => validateNavConfig(navConfig, availPages), [navConfig, availPages]);

  // Custom code (previews live for CSS; HTML only after a sanitized save).
  const [cssSection, setCssSection] = useState('stats');
  const [cssDrafts, setCssDrafts] = useState<Record<string, string>>({});
  const [htmlDraft, setHtmlDraft] = useState('');
  const [codeSeeded, setCodeSeeded] = useState(false);
  useEffect(() => {
    if (!profile || codeSeeded) return;
    const stored = (profile.customSectionCss ?? {}) as Record<string, string>;
    setCssDrafts(typeof stored === 'object' && stored ? { ...stored } : {});
    setHtmlDraft(typeof profile.customHtmlBlock === 'string' ? profile.customHtmlBlock : '');
    setCodeSeeded(true);
  }, [profile, codeSeeded]);

  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  // The preview renders at a REAL viewport width (desktop 1280 / mobile 390)
  // and is scaled down to fit its column — otherwise the iframe inherits the
  // rail's leftover width, the site renders its tablet layout, and what the
  // admin sees is not what any visitor gets.
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [previewBox, setPreviewBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const measure = () => setPreviewBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<string>('top');
  const toggle = useCallback((id: string) => {
    setOpen((o) => {
      const next = { ...o, [id]: !o[id] };
      if (next[id]) setFocus(GROUP_FOCUS[id] ?? 'top'); // opening → scroll the preview there
      return next;
    });
  }, []);
  const groupCtx = useMemo(() => ({ open, toggle }), [open, toggle]);

  // ── live preview ──
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reloadPreview = useCallback(() => { const f = iframeRef.current; if (f) f.src = '/preview'; }, []);
  // The page currently being edited, sent to the preview so it shows that page
  // live (new pages included) and returns home when the editor closes.
  const [editingPage, setEditingPage] = useState<{ id: string | null; title: string; blocks: Block[]; published: boolean; showInNav: boolean } | null>(null);
  // An admin-built homepage section being edited (lives in the look, not a page).
  const [editingSection, setEditingSection] = useState<{ id: string; title: string; blocks: Block[] } | null>(null);
  const postPreview = useCallback(() => {
    let overrides: Record<string, unknown> = { ...current, customSectionCss: cssDrafts };
    // Live-preview an in-progress custom section the same way page edits
    // preview: upsert the buffer into the blob the preview renders from.
    if (editingSection) {
      const blob = { ...((current.sectionVariants ?? {}) as Record<string, unknown>) };
      const list = normalizeHomeSections(blob[HOME_SECTIONS_KEY]);
      const exists = list.some((s) => s.id === editingSection.id);
      blob[HOME_SECTIONS_KEY] = exists
        ? list.map((s) => (s.id === editingSection.id ? editingSection : s))
        : [...list, editingSection];
      overrides = { ...overrides, sectionVariants: blob };
    }
    const page = editingPage ? { title: editingPage.title, blocks: editingPage.blocks } : null;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'sk-studio-preview', overrides, focus: page ? 'page' : focus, page },
      window.location.origin,
    );
  }, [current, cssDrafts, focus, editingPage, editingSection]);
  useEffect(() => { postPreview(); }, [postPreview]);
  // A section buffer belongs to the look it was opened on — switching looks
  // must not let a Save land the section in a different look's config.
  useEffect(() => { setEditingSection(null); }, [activeId]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string } | null)?.type === 'sk-studio-ready') postPreview();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postPreview]);

  // ── mutations ──
  const invalidateContent = () => void queryClient.invalidateQueries({ queryKey: ['site-content'] });
  const invalidateDrafts = () => void queryClient.invalidateQueries({ queryKey: ['design-drafts'] });

  // Editing the LIVE theme: push the working changes to the public site.
  const publishLive = useMutation({
    mutationFn: () => api.put('/site/profile', current),
    onSuccess: () => { invalidateContent(); clearWorking('live'); toast.success('Published — visitors now see this look'); },
    onError: (err: Error) => toast.error(`Publish failed: ${err.message}`),
  });
  // Save the working changes to the DRAFT being edited (keeps its name/schedule).
  const saveDraftMut = useMutation({
    mutationFn: (id: string) => api.put(`/site/design-drafts/${id}`, { name: draftsById[id]?.name ?? 'Draft', config: working[id] ?? base }),
    onSuccess: (_d, id) => { invalidateDrafts(); clearWorking(id); toast.success('Saved to this draft'); },
    onError: (err: Error) => toast.error(`Could not save: ${err.message}`),
  });
  // Create a NEW draft from whatever is currently being edited, and switch to it.
  const [newName, setNewName] = useState('');
  const newDraftMut = useMutation({
    mutationFn: () => api.post<{ id: string }>('/site/design-drafts', { name: newName.trim() || 'New theme', config: current }),
    onSuccess: (created) => {
      setNewName('');
      invalidateDrafts();
      if (created?.id) { clearWorking(activeId); setEditingId(created.id); }
      toast.success('New draft created — you are editing it now');
    },
    onError: (err: Error) => toast.error(`Could not create the draft: ${err.message}`),
  });
  const publishDraftMut = useMutation({
    mutationFn: (id: string) => api.post(`/site/design-drafts/${id}/publish`),
    onSuccess: (_d, id) => { invalidateContent(); invalidateDrafts(); clearWorking(id); setEditingId('live'); toast.success('Published — this theme is now live'); },
    onError: (err: Error) => toast.error(err.message),
  });
  const renameDraftMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.put(`/site/design-drafts/${id}`, { name, config: draftsById[id]?.config ?? {} }),
    onSuccess: () => invalidateDrafts(),
    onError: (err: Error) => toast.error(err.message),
  });
  const scheduleDraftMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.put(`/site/design-drafts/${id}`, body),
    onSuccess: () => invalidateDrafts(),
    onError: (err: Error) => toast.error(err.message),
  });
  const deleteDraftMut = useMutation({
    mutationFn: (id: string) => api.del(`/site/design-drafts/${id}`),
    onSuccess: (_d, id) => { invalidateDrafts(); clearWorking(id); if (activeId === id) setEditingId('live'); toast.success('Draft deleted'); },
    onError: (err: Error) => toast.error(err.message),
  });
  const codeMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.put('/site/profile', patch),
    onSuccess: () => { invalidateContent(); toast.success('Custom code saved (sanitized server-side)'); },
    onError: (err: Error) => toast.error(`Could not save: ${err.message}`),
  });

  // ── assets: logo + hero photos (instant save; reload the preview) ──
  const [uploading, setUploading] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const heroSlotFile = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef(0);
  const slotIds = (data?.homepage?.heroImageAssetIds ?? []) as string[];
  const heroUrlOf = (id: string) => heroMedia.data?.find((m) => m.id === id)?.url ?? null;
  const uploadLogo = useCallback(async (file: File) => {
    setUploading('logo');
    try {
      const fd = new FormData(); fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=LOGO', { method: 'POST', body: fd });
      await api.put('/site/profile', { logoAssetId: asset.id });
      setLogoPreview(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      reloadPreview(); toast.success('Logo uploaded');
    } catch (err) { toast.error(`Logo upload failed: ${(err as Error).message}`); } finally { setUploading(null); }
  }, [api, queryClient, reloadPreview]);
  async function saveSlots(ids: string[]) {
    await api.put('/site/homepage', { heroImageAssetIds: ids });
    void queryClient.invalidateQueries({ queryKey: ['site-content'] });
    void queryClient.invalidateQueries({ queryKey: ['site-media-hero'] });
    reloadPreview();
  }
  async function uploadSlot(index: number, file: File) {
    setUploading('hero');
    try {
      const fd = new FormData(); fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=HERO', { method: 'POST', body: fd });
      const ids = [...slotIds]; ids[index] = asset.id;
      await saveSlots(ids.filter(Boolean).slice(0, 5));
    } catch (err) { toast.error(`Image upload failed: ${(err as Error).message}`); } finally { setUploading(null); }
  }

  // ── custom pages ──
  const pageMutation = useMutation({
    mutationFn: (p: { id: string | null; title: string; blocks: Block[]; published: boolean; showInNav: boolean }) =>
      p.id ? api.put(`/site/pages/${p.id}`, { title: p.title, blocks: p.blocks, published: p.published, showInNav: p.showInNav })
           : api.post('/site/pages', { title: p.title, blocks: p.blocks, published: p.published, showInNav: p.showInNav }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['school-pages'] }); setEditingPage(null); toast.success('Page saved'); },
    onError: (err: Error) => toast.error(`Could not save the page: ${err.message}`),
  });
  const pageDelete = useMutation({
    mutationFn: (id: string) => api.del(`/site/pages/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['school-pages'] }); toast.success('Page removed'); },
    onError: (err: Error) => toast.error(err.message),
  });

  // derived look helpers
  const festive = normalizeFestiveTheme(current.festiveTheme);
  const festiveDef = festive ? FESTIVALS.find((f) => f.value === festive.festival) : null;
  const footer = normalizeFooterConfig(current.footerConfig);
  const variants = normalizeSectionVariants(current.sectionVariants);
  // Custom sections + band order share the sectionVariants Json under reserved
  // keys, so EVERY write goes through one composer that re-embeds all three —
  // a plain per-band save must never silently drop the admin's order/sections.
  const homeSecs = homeSectionsOf(current.sectionVariants);
  const order = sectionOrderOf(current.sectionVariants, homeSecs.map((s) => s.id));
  const writeSectionConfig = (patch: { v?: SectionVariants; order?: string[]; custom?: HomeSection[] }) => {
    const v = patch.v ?? variants;
    const c = patch.custom ?? homeSecs;
    const ids = c.map((s) => s.id);
    const o = normalizeSectionOrder(patch.order ?? order, ids);
    const blob: Record<string, unknown> = { ...v };
    if (c.length) blob[HOME_SECTIONS_KEY] = c;
    // Only store an order that differs from the default, so an untouched page
    // keeps a byte-identical config (and theme "In use" matching keeps working).
    if (o.join('|') !== normalizeSectionOrder(undefined, ids).join('|')) blob[SECTION_ORDER_KEY] = o;
    setLook({ sectionVariants: blob });
  };
  const setVariant = (key: SectionKey, patch: { layout?: string; gesture?: string }) =>
    writeSectionConfig({ v: { ...variants, [key]: { ...(variants[key] ?? {}), ...patch } } });
  const moveBand = (i: number, by: number) => {
    const next = [...order]; const j = i + by;
    if (j < 0 || j >= next.length) return;
    const [row] = next.splice(i, 1); next.splice(j, 0, row);
    writeSectionConfig({ order: next });
  };
  const removeSection = (id: string) =>
    writeSectionConfig({ custom: homeSecs.filter((s) => s.id !== id), order: order.filter((k) => k !== `x:${id}`) });
  // A section that would not survive normalization (no title and no valid
  // block) must not be saveable — it would silently vanish from the list and
  // the next config write would erase it for good.
  const sectionSaveable = !!editingSection && normalizeHomeSections([editingSection]).length === 1;
  const saveSection = () => {
    if (!editingSection || !sectionSaveable) return;
    const next = editingSection as unknown as HomeSection;
    const exists = homeSecs.some((s) => s.id === next.id);
    writeSectionConfig({ custom: exists ? homeSecs.map((s) => (s.id === next.id ? next : s)) : [...homeSecs, next] });
    setEditingSection(null);
  };
  const editSecBlock = (i: number, patch: Partial<Block>) =>
    setEditingSection((p) => (p ? { ...p, blocks: p.blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)) } : p));
  const moveSecBlock = (i: number, dir: -1 | 1) => setEditingSection((p) => {
    if (!p) return p; const next = [...p.blocks]; const j = i + dir; if (j < 0 || j >= next.length) return p;
    const [b] = next.splice(i, 1); next.splice(j, 0, b); return { ...p, blocks: next };
  });
  const heroLayout = (current.heroLayout as string) ?? 'ILLUSTRATION';
  const heroSpec = HERO_LAYOUTS.find((l) => l.value === heroLayout) ?? HERO_LAYOUTS[0];
  const overlayOn = OVERLAY_LAYOUTS.includes(heroLayout);
  const brand1 = (current.brandColorPrimary as string) ?? '#2f6b4f';
  const brand2 = (current.brandColorSecondary as string) ?? '#e8b04b';

  // Apply a whole ready-made theme as the starting point (every axis at once);
  // themePreset stays a valid CUSTOM so the profile PUT never 400s, and the
  // theme highlights via a signature-field match instead. A theme replaces the
  // per-band variants but must never delete the admin's own sections or their
  // saved order — those are content, not styling — so re-embed the reserved keys.
  const applyTheme = (t: StartTheme) => {
    const blob: Record<string, unknown> = { ...t.config.sectionVariants };
    if (homeSecs.length) blob[HOME_SECTIONS_KEY] = homeSecs;
    const ids = homeSecs.map((s) => s.id);
    if (order.join('|') !== normalizeSectionOrder(undefined, ids).join('|')) blob[SECTION_ORDER_KEY] = order;
    setLook({ ...t.config, sectionVariants: blob, themePreset: 'CUSTOM' });
  };

  // menu edit helpers (operate on the look's navConfig)
  const editMenu = (fn: (items: NavConfigItem[]) => NavConfigItem[]) =>
    setLook({ navConfig: { items: fn(navConfig.items.map((i) => ({ ...i, children: [...i.children] }))) } });
  const moveMenu = (index: number, by: number) => editMenu((items) => {
    const to = index + by; if (to < 0 || to >= items.length) return items;
    const [row] = items.splice(index, 1); items.splice(to, 0, row); return items;
  });
  const promoteMenu = (itemIndex: number, childKey: string) => editMenu((items) => {
    const item = items[itemIndex]; const child = item.children.find((c) => c.key === childKey); if (!child) return items;
    item.children = item.children.filter((c) => c.key !== childKey);
    items.push({ key: child.key, slug: child.key, label: child.label, behaviour: 'page', children: [] });
    return items.filter((i) => i.behaviour !== 'menu' || i.children.length > 0);
  });
  const demoteMenu = (itemIndex: number, intoIndex: number) => editMenu((items) => {
    const item = items[itemIndex]; const into = items[intoIndex]; if (!item || !into || item === into) return items;
    into.children.push({ key: item.key, label: item.label });
    return items.filter((_, i) => i !== itemIndex);
  });

  const editBlock = (i: number, patch: Partial<Block>) => setEditingPage((p) => p ? { ...p, blocks: p.blocks.map((b, j) => j === i ? ({ ...b, ...patch } as Block) : b) } : p);
  const moveBlock = (i: number, dir: -1 | 1) => setEditingPage((p) => {
    if (!p) return p; const next = [...p.blocks]; const j = i + dir; if (j < 0 || j >= next.length) return p;
    [next[i], next[j]] = [next[j], next[i]]; return { ...p, blocks: next };
  });

  const PAGE_LABELS: Record<string, string> = { about: 'About', hof: 'Hall of Fame', gallery: 'Gallery', academics: 'Academics', admissions: 'Admissions', connect: 'Connect', blog: 'Blog', contact: 'Contact' };

  const rail = (
    <GroupCtx.Provider value={groupCtx}>
    <div className="flex flex-col gap-2.5">
      {/* Theme manager — always visible. You edit ONE theme; it's obvious which. */}
      <Card className="p-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Themes</h3>
          <span className={['rounded-full border px-2.5 py-0.5 text-[11px] font-bold',
            dirty ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-400'].join(' ')}>
            {dirty ? (activeId === 'live' ? '● Unpublished changes' : '● Unsaved changes') : (activeId === 'live' ? '✓ Matches live' : '✓ Saved')}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Pick a theme to edit — your live site or a saved draft. Everything below changes the one you&rsquo;re editing, live on the right.</p>

        {/* The list of themes to choose from */}
        <div className="mt-2.5 flex flex-col gap-1.5">
          {[{ id: 'live', name: 'Live site', publishAt: null as string | null }, ...(drafts.data ?? [])].map((t) => {
            const selected = activeId === t.id;
            const hasEdits = !!working[t.id] && sig(working[t.id]) !== sig(baseLook(t.id));
            return (
              <button key={t.id} type="button" onClick={() => { setEditingId(t.id); setShowSchedule(false); }} aria-pressed={selected}
                className={['sk-press flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                  selected ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'].join(' ')}>
                <span className={`h-2 w-2 flex-none rounded-full ${t.id === 'live' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="flex-1 truncate text-sm font-semibold text-slate-700">{t.name}</span>
                {t.id === 'live' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">LIVE</span>}
                {(t as { publishAt?: string | null }).publishAt && <span className="text-[10px] text-slate-400">📅 {fmtDate((t as { publishAt: string }).publishAt)}</span>}
                {hasEdits && <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-400" title="Unsaved edits" />}
              </button>
            );
          })}
          <div className="mt-0.5 flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New theme name (e.g. Diwali ✨)" maxLength={80} className="h-8 text-sm" />
            <Button size="sm" variant="outline" onClick={() => newDraftMut.mutate()} disabled={newDraftMut.isPending}>+ New draft</Button>
          </div>
        </div>

        {/* Actions for the theme you're editing */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Editing</div>
          {activeId === 'live' ? (
            <div className="text-sm font-semibold text-slate-800">Live site</div>
          ) : (
            // Uncontrolled + commit on blur: renaming on every keystroke would
            // round-trip to the server and jump the cursor. key resets it per theme.
            <Input key={activeId} defaultValue={draftsById[activeId]?.name ?? ''} maxLength={80} aria-label="Theme name"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== draftsById[activeId]?.name) renameDraftMut.mutate({ id: activeId, name: v }); }}
              className="mt-0.5 h-8 text-sm font-semibold" />
          )}

          {!navCheck.ok && (
            <div role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
              <b>The menu needs fixing before you can publish:</b>
              <ul className="mt-1 list-disc pl-4">{navCheck.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}

          {activeId === 'live' ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => publishLive.mutate()} disabled={!dirty || !navCheck.ok || publishLive.isPending}>
                {publishLive.isPending ? 'Publishing…' : 'Publish changes'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => clearWorking('live')} disabled={!dirty}>Discard</Button>
            </div>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => saveDraftMut.mutate(activeId)} disabled={!dirty || saveDraftMut.isPending}>
                  {saveDraftMut.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => clearWorking(activeId)} disabled={!dirty}>Discard</Button>
                <Button size="sm" variant="outline" onClick={() => publishDraftMut.mutate(activeId)} disabled={!navCheck.ok || publishDraftMut.isPending}>Publish now → live</Button>
                <button type="button" className="text-xs font-semibold text-rose-500 hover:text-rose-700" onClick={() => deleteDraftMut.mutate(activeId)}>Delete</button>
              </div>
              <button type="button" onClick={() => setShowSchedule((s) => !s)} aria-expanded={showSchedule}
                className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-slate-700">
                {showSchedule ? '▾' : '▸'} Schedule this theme (festival editions)
              </button>
              {showSchedule && (
                <div className="mt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">Go live on</label>
                      <input type="date" aria-label="Go live date"
                        value={draftsById[activeId]?.publishAt ? draftsById[activeId]!.publishAt!.slice(0, 10) : ''}
                        onChange={(e) => scheduleDraftMut.mutate({ id: activeId, body: { name: draftsById[activeId]?.name ?? 'Draft', config: draftsById[activeId]?.config ?? {}, publishAt: e.target.value || null } })}
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">Revert on</label>
                      <input type="date" aria-label="Revert date"
                        value={draftsById[activeId]?.revertAt ? draftsById[activeId]!.revertAt!.slice(0, 10) : ''}
                        onChange={(e) => scheduleDraftMut.mutate({ id: activeId, body: { name: draftsById[activeId]?.name ?? 'Draft', config: draftsById[activeId]?.config ?? {}, revertAt: e.target.value || null } })}
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400">This theme goes live by itself on the go-live date and reverts after the revert date — no clicks needed. Save your edits first so the scheduled version includes them.</p>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ── Brand & theme ── */}
      {/* ── Start from a theme ── */}
      <Group id="start-theme" title="Start from a theme" summary="A complete, ready-made design to begin from">
        <p className="mb-2 text-[11px] text-slate-500">Pick a complete design as your starting point — colours, font, first screen, section style, navbar and footer, all at once. Then change anything below; it&rsquo;s still your look.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {START_THEMES.map((t) => {
            const on = themeInUse(t, current);
            return (
              <button key={t.id} type="button" onClick={() => applyTheme(t)} aria-pressed={on}
                className={['rounded-xl border p-2.5 text-left transition', on ? 'border-teal-600 ring-2 ring-teal-100' : 'border-slate-200 hover:border-slate-300'].join(' ')}>
                <div className="flex items-center gap-1.5">
                  <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: t.config.brandColorPrimary }} />
                  <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: t.config.brandColorSecondary }} />
                  <span className="ml-1 text-sm font-semibold text-slate-800">{t.name}</span>
                  {on && <span className="ml-auto text-[10px] font-bold text-teal-700">STARTED FROM</span>}
                </div>
                <div className="mt-1 text-[11px] font-semibold text-teal-700/80">{t.audience}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{t.blurb}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Applying a theme replaces the design fields below (not your logo, photos or written content). More themes — including premium scroll-motion ones — are on the way.</p>
      </Group>

      {/* ── Brand & theme (fine-tuning) ── */}
      <Group id="brand" title="Brand & theme" summary="Colours, font, animation">
        <FieldLabel>Primary colour</FieldLabel>
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Primary colour" value={brand1} onChange={(e) => setLook({ brandColorPrimary: e.target.value, themePreset: 'CUSTOM' })} className="h-9 w-12 cursor-pointer rounded border border-slate-300 p-0.5" />
          <Input value={brand1} onChange={(e) => setLook({ brandColorPrimary: e.target.value, themePreset: 'CUSTOM' })} maxLength={7} className="h-9 font-mono text-sm" />
        </div>
        <FieldLabel>Accent colour</FieldLabel>
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Accent colour" value={brand2} onChange={(e) => setLook({ brandColorSecondary: e.target.value, themePreset: 'CUSTOM' })} className="h-9 w-12 cursor-pointer rounded border border-slate-300 p-0.5" />
          <Input value={brand2} onChange={(e) => setLook({ brandColorSecondary: e.target.value, themePreset: 'CUSTOM' })} maxLength={7} className="h-9 font-mono text-sm" />
        </div>
        <FieldLabel>Heading font</FieldLabel>
        <Chips options={FONT_OPTIONS} value={(current.headingFont as string) ?? 'INTER'} onPick={(v) => setLook({ headingFont: v, themePreset: 'CUSTOM' })} />
        <FieldLabel>Animation level</FieldLabel>
        <Chips options={MOTION_OPTIONS} value={(current.animationLevel as string) ?? 'FULL'} onPick={(v) => setLook({ animationLevel: v })} />
        <FieldLabel>Logo</FieldLabel>
        <div className="rounded-lg border border-slate-200 p-2.5">
          <ImageUploader label="School logo" hint="PNG or SVG. Max 8 MB. Saves and updates the preview immediately."
            previewUrl={logoPreview} hasExistingAsset={!!profile?.logoAssetId} isUploading={uploading === 'logo'} onFile={uploadLogo} />
        </div>
      </Group>

      {/* ── First screen ── */}
      <Group id="hero" title="First screen" summary={heroSpec.label}>
        <FieldLabel>Layout</FieldLabel>
        <Chips options={HERO_LAYOUTS} value={heroLayout} onPick={(v) => setLook({ heroLayout: v })} />
        <p className="mt-1.5 rounded-lg border border-teal-100 bg-teal-50 px-2.5 py-1.5 text-[11px] text-teal-800">{heroSpec.hint}</p>
        {heroSpec.slots > 0 && (
          <>
            <FieldLabel>Photos ({heroSpec.slots} for this layout)</FieldLabel>
            <input ref={heroSlotFile} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadSlot(pendingSlot.current, f); e.target.value = ''; }} />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: heroSpec.slots }).map((_, i) => {
                const id = slotIds[i]; const url = id ? heroUrlOf(id) : null;
                return (
                  <div key={i} className="w-28">
                    {id ? (
                      <div className="group relative h-20 w-28 overflow-hidden rounded-lg border border-slate-200">
                        {url ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt={`Hero ${i + 1}`} className="h-full w-full object-cover" />) : <div className="grid h-full w-full place-items-center bg-slate-100 text-[10px] text-slate-400">image {i + 1}</div>}
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                          <button type="button" aria-label="Move image left" disabled={i === 0} onClick={() => { const ids = [...slotIds]; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; void saveSlots(ids); }} className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-30"><ArrowLeft className="h-3 w-3" /></button>
                          <button type="button" aria-label="Remove image" onClick={() => void saveSlots(slotIds.filter((_, j) => j !== i))} className="rounded p-0.5 text-white hover:bg-rose-500/60"><X className="h-3 w-3" /></button>
                          <button type="button" aria-label="Move image right" disabled={i >= slotIds.length - 1} onClick={() => { const ids = [...slotIds]; [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; void saveSlots(ids); }} className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-30"><ArrowRight className="h-3 w-3" /></button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" disabled={uploading === 'hero' || i > slotIds.length} onClick={() => { pendingSlot.current = i; heroSlotFile.current?.click(); }}
                        className="grid h-20 w-28 place-items-center rounded-lg border-2 border-dashed border-slate-300 text-[10px] font-medium text-slate-500 hover:border-slate-400 disabled:opacity-40">
                        <span className="flex items-center gap-1"><Upload className="h-3 w-3" />{uploading === 'hero' ? 'Uploading…' : `Add ${i + 1}`}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Wide landscape photos. Max 4 MB. First image is the main one. Saves immediately.</p>
          </>
        )}
        <FieldLabel>Background media</FieldLabel>
        <Chips options={HERO_MEDIA_OPTIONS} value={(current.heroMedia as string) ?? 'IMAGE'} onPick={(v) => {
          setLook({ heroMedia: v, ...(v === 'VIDEO' && !VIDEO_LAYOUTS.includes(heroLayout) ? { heroLayout: 'FULL_BLEED' } : {}) });
          if (v === 'VIDEO' && !VIDEO_LAYOUTS.includes(heroLayout)) toast.success('Background video needs a photo layout — switched to Full canvas');
        }} />
        {current.heroMedia === 'VIDEO' && (
          <>
            <FieldLabel>Video URL (mp4/webm)</FieldLabel>
            <Input value={(current.heroVideoUrl as string) ?? ''} placeholder="https://…/campus.mp4" onChange={(e) => setLook({ heroVideoUrl: e.target.value })} className="h-9 text-sm" />
            <p className="mt-1 text-[11px] text-slate-400">Muted loop; your first photo is the poster and the reduced-motion fallback.</p>
          </>
        )}
        <FieldLabel>Headline accent</FieldLabel>
        <Chips options={HEADLINE_ACCENTS} value={(current.headlineAccent as string) ?? 'DRAW'} onPick={(v) => setLook({ headlineAccent: v })} />
        <FieldLabel>Text alignment</FieldLabel>
        <Chips options={HERO_ALIGN} value={(current.heroTextAlign as string) ?? 'LEFT'} onPick={(v) => setLook({ heroTextAlign: v })} />
        <FieldLabel>Height</FieldLabel>
        <Chips options={HERO_HEIGHT} value={(current.heroHeight as string) ?? 'FULL'} onPick={(v) => setLook({ heroHeight: v })} />
        <div className={overlayOn ? '' : 'opacity-50'}>
          <FieldLabel>Overlay on photos</FieldLabel>
          <Chips options={HERO_OVERLAY} value={(current.heroOverlayStyle as string) ?? 'WASH'} onPick={(v) => overlayOn && setLook({ heroOverlayStyle: v })} />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Overlay strength</span>
            <input type="range" min={10} max={95} step={5} disabled={!overlayOn} value={(current.heroOverlayOpacity as number) ?? 65}
              onChange={(e) => setLook({ heroOverlayOpacity: Number(e.target.value) })} className="flex-1 accent-teal-600" aria-label="Overlay strength" />
            <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-slate-600">{(current.heroOverlayOpacity as number) ?? 65}%</span>
          </div>
        </div>
      </Group>

      {/* ── Quick styles ── */}
      <Group id="looks" title="Quick styles" summary="Sets shape, motion, texture & accent in one tap">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STYLE_PRESETS.map((p) => {
            const on = (current.sectionShape ?? 'SOFT') === p.values.sectionShape && (current.motionGesture ?? 'RISE') === p.values.motionGesture
              && (current.backgroundTexture ?? 'NONE') === p.values.backgroundTexture && (current.headlineAccent ?? 'DRAW') === p.values.headlineAccent;
            return (
              <button key={p.value} type="button" onClick={() => setLook({ ...p.values })} aria-pressed={on}
                className={['rounded-xl border p-2.5 text-left transition', on ? 'border-teal-600 ring-2 ring-teal-100' : 'border-slate-200 hover:border-slate-300'].join(' ')}>
                <span className="block text-sm font-semibold text-slate-800">{p.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{p.hint}</span>
                {on && <span className="mt-1 block text-[11px] font-semibold text-teal-700">In use</span>}
              </button>
            );
          })}
        </div>
      </Group>

      {/* ── Section styling ── */}
      <Group id="sections-style" title="Section styling" summary="Shape, arrival, background">
        <FieldLabel>Section shape (below the hero)</FieldLabel>
        <Chips options={SECTION_SHAPES} value={(current.sectionShape as string) ?? 'SOFT'} onPick={(v) => setLook({ sectionShape: v })} />
        <FieldLabel>How sections arrive</FieldLabel>
        <Chips options={MOTION_GESTURES} value={(current.motionGesture as string) ?? 'RISE'} onPick={(v) => setLook({ motionGesture: v })} />
        <FieldLabel>Background texture</FieldLabel>
        <Chips options={BACKGROUND_TEXTURES} value={(current.backgroundTexture as string) ?? 'NONE'} onPick={(v) => setLook({ backgroundTexture: v })} />
        <FieldLabel>Scroll feel</FieldLabel>
        <Stack options={SCROLL_FEELS} value={(current.scrollFeel as string) ?? 'CLASSIC'} onPick={(v) => setLook({ scrollFeel: v })} />
      </Group>

      {/* ── Per-section variants ── */}
      <Group id="variants" title="Per-section layout" summary="A layout & entrance for each band">
        {SECTION_KEYS.map((key) => {
          const def = SECTION_VARIANT_DEFS[key];
          return (
            <div key={key} className="border-b border-slate-100 pb-2.5 pt-2.5 first:pt-0 last:border-0 last:pb-0">
              <div className="text-sm font-semibold text-slate-700">{def.label}</div>
              <div className="mt-1.5"><Chips options={def.layouts} value={variants[key]?.layout ?? def.layouts[0].value} onPick={(v) => setVariant(key, { layout: v })} /></div>
              <div className="mt-1.5"><Chips options={[{ value: 'DEFAULT', label: 'Page default' }, { value: 'RISE', label: 'Rise' }, { value: 'SLIDE', label: 'Slide' }, { value: 'ZOOM', label: 'Zoom' }, { value: 'DRAW', label: 'Wipe' }, { value: 'CURTAIN', label: 'Curtain' }, { value: 'FLIP', label: 'Flip' }, { value: 'FADE', label: 'Fade' }]} value={variants[key]?.gesture ?? 'DEFAULT'} onPick={(v) => setVariant(key, { gesture: v })} /></div>
            </div>
          );
        })}
      </Group>

      {/* ── Homepage structure: band order + admin-built sections. These are
          CONTENT, not styling, so they are edited on the live site only —
          a saved look neither carries nor deletes them. ── */}
      <Group id="structure" title="Homepage structure" summary={homeSecs.length ? `Band order · ${homeSecs.length} custom section${homeSecs.length === 1 ? '' : 's'}` : 'Band order & your own sections'}>
        {activeId !== 'live' ? (
          <p className="text-[11px] text-slate-400">The section order and your own sections belong to the live site (they’re content, not styling), so a saved look never changes them. Switch to <span className="font-semibold">Live site</span> to edit them.</p>
        ) : (<>
        <FieldLabel>Section order (top to bottom)</FieldLabel>
        <p className="mb-2 text-[11px] text-slate-400">The hero stays first and the footer last. A band with nothing to show is skipped automatically, so reordering never leaves a hole.</p>
        <div className="flex flex-col gap-1.5">
          {order.map((k, i) => {
            const custom = k.startsWith('x:');
            const label = custom
              ? (homeSecs.find((s) => `x:${s.id}` === k)?.title || 'Custom section')
              : (ORDERABLE_HOME_SECTIONS.find((s) => s.key === k)?.label ?? k);
            return (
              <div key={k} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5">
                <span className="flex-1 truncate text-sm text-slate-700">{label}{custom && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-teal-600">custom</span>}</span>
                <button type="button" aria-label={`Move ${label} up`} disabled={i === 0} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveBand(i, -1)}>▲</button>
                <button type="button" aria-label={`Move ${label} down`} disabled={i === order.length - 1} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveBand(i, 1)}>▼</button>
              </div>
            );
          })}
        </div>
        <FieldLabel>Your own sections</FieldLabel>
        <p className="mb-2 text-[11px] text-slate-400">Add a band of your own — heading, text, images, a button — then place it anywhere above. It wears your theme automatically.</p>
        {homeSecs.map((s) => (
          <div key={s.id} className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5">
            <span className="flex-1 truncate text-sm font-semibold text-slate-700">{s.title || 'Untitled section'}</span>
            <span className="text-[11px] text-slate-400">{s.blocks.length} block{s.blocks.length === 1 ? '' : 's'}</span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditingSection({ id: s.id, title: s.title, blocks: (s.blocks as Block[]).map((b) => ({ ...b })) })}>Edit</Button>
            <button type="button" aria-label={`Remove ${s.title || 'section'}`} className="text-xs text-rose-500 hover:text-rose-700" onClick={() => removeSection(s.id)}>✕</button>
          </div>
        ))}
        {!editingSection && (
          <Button size="sm" variant="outline" disabled={homeSecs.length >= HOME_SECTION_MAX}
            onClick={() => setEditingSection({ id: `s${Date.now().toString(36)}`, title: '', blocks: [{ t: 'h', text: '' }, { t: 'p', text: '' }] })}>
            + New section{homeSecs.length >= HOME_SECTION_MAX ? ` (max ${HOME_SECTION_MAX})` : ''}
          </Button>
        )}
        {editingSection && (
          <div className="flex flex-col gap-2.5 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
            <div><Label className="text-xs">Section heading (shown centred above its content)</Label>
              <Input value={editingSection.title} maxLength={120} placeholder="Why families choose us" onChange={(e) => setEditingSection({ ...editingSection, title: e.target.value })} className="mt-1 h-9 bg-white text-sm" /></div>
            {editingSection.blocks.map((b, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-white p-2">
                <div className="flex items-center gap-1">
                  <span className="flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{BLOCK_NAMES[b.t]}</span>
                  <button type="button" aria-label="Move up" disabled={i === 0} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveSecBlock(i, -1)}>▲</button>
                  <button type="button" aria-label="Move down" disabled={i === editingSection.blocks.length - 1} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveSecBlock(i, 1)}>▼</button>
                  <button type="button" aria-label="Remove block" className="px-1 text-xs text-rose-400 hover:text-rose-600" onClick={() => setEditingSection({ ...editingSection, blocks: editingSection.blocks.filter((_, j) => j !== i) })}>✕</button>
                </div>
                {(b.t === 'h' || b.t === 'cta') && <Input value={b.t === 'h' ? b.text : b.label} maxLength={b.t === 'h' ? 200 : 80} placeholder={b.t === 'h' ? 'Heading' : 'Button label'} onChange={(e) => editSecBlock(i, b.t === 'h' ? { text: e.target.value } : { label: e.target.value })} className="mt-1 h-8 text-sm" />}
                {(b.t === 'p' || b.t === 'imgtext') && <Textarea value={b.text} rows={2} placeholder="Write something…" onChange={(e) => editSecBlock(i, { text: e.target.value })} className="mt-1 text-sm" />}
                {(b.t === 'img' || b.t === 'imgtext') && (
                  <div className="mt-1 flex gap-1.5">
                    <Input value={b.url ?? ''} placeholder="https://… image URL" onChange={(e) => editSecBlock(i, { url: e.target.value })} className={`h-8 flex-1 text-xs${b.url && !isSafeBlockUrl(b.url) ? ' border-rose-300' : ''}`} />
                    {(galleryMedia.data ?? []).length > 0 && (
                      <select aria-label="Use a gallery photo" className="h-8 rounded-md border border-slate-200 text-xs text-slate-500" value="" onChange={(e) => e.target.value && editSecBlock(i, { url: e.target.value })}>
                        <option value="">Gallery…</option>{(galleryMedia.data ?? []).map((m, j) => <option key={m.id} value={m.url}>Photo {j + 1}</option>)}
                      </select>
                    )}
                  </div>
                )}
                {(b.t === 'img' || b.t === 'imgtext') && !!b.url && !isSafeBlockUrl(b.url) && (
                  <p className="mt-1 text-[10px] text-rose-500">Use a full https:// address (or a /path on your site) — anything else is dropped.</p>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(BLOCK_NAMES) as Block['t'][]).map((t) => (
                <button key={t} type="button" disabled={editingSection.blocks.length >= 40} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40"
                  onClick={() => { if (editingSection.blocks.length >= 40) return; setEditingSection({ ...editingSection, blocks: [...editingSection.blocks, t === 'h' ? { t, text: '' } : t === 'p' ? { t, text: '' } : t === 'img' ? { t, url: '' } : t === 'imgtext' ? { t, url: null, text: '' } : { t, label: 'Learn more' }] }); }}>+ {BLOCK_NAMES[t]}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveSection} disabled={!sectionSaveable}>Save section</Button>
              <Button size="sm" variant="outline" onClick={() => setEditingSection(null)}>Cancel</Button>
            </div>
          </div>
        )}
        </>)}
      </Group>

      {/* ── Navigation ── */}
      <Group id="nav" title="Navigation" summary={`${(current.navStyle as string) ?? 'CLASSIC'} bar · menu`}>
        <FieldLabel>Navbar style</FieldLabel>
        <Chips options={NAV_STYLES} value={(current.navStyle as string) ?? 'CLASSIC'} onPick={(v) => setLook({ navStyle: v })} />
        <FieldLabel>Bar colour</FieldLabel>
        <Chips options={NAV_COLORS} value={(current.navColor as string) ?? 'PAPER'} onPick={(v) => setLook({ navColor: v })} />
        <FieldLabel>Text colour</FieldLabel>
        <Chips options={NAV_TEXT} value={(current.navTextColor as string) ?? 'AUTO'} onPick={(v) => setLook({ navTextColor: v })} />
        <FieldLabel>Sign-in button</FieldLabel>
        <Chips options={LOGIN_STYLES} value={(current.navLoginStyle as string) ?? 'LINK'} onPick={(v) => setLook({ navLoginStyle: v })} />
        <FieldLabel>Dropdown open animation</FieldLabel>
        <Chips options={NAV_DROPDOWN_ANIMS} value={(current.navDropdownAnim as string) ?? 'FADE'} onPick={(v) => setLook({ navDropdownAnim: v })} />
        <div className="mt-3 grid grid-cols-1 gap-2">
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label className="text-xs">Enquiry button text</Label>
              <Input value={(current.navCtaLabel as string) ?? 'Enquire'} maxLength={40} onChange={(e) => setLook({ navCtaLabel: e.target.value })} className="mt-1 h-9 text-sm" /></div>
          </div>
          <Toggle checked={(current.navShowCta as boolean) ?? true} onChange={(v) => setLook({ navShowCta: v })} label="Show the enquiry button" />
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label className="text-xs">Login link text</Label>
              <Input value={(current.navLoginLabel as string) ?? 'Login'} maxLength={40} onChange={(e) => setLook({ navLoginLabel: e.target.value })} className="mt-1 h-9 text-sm" /></div>
          </div>
          <Toggle checked={(current.navShowLogin as boolean) ?? true} onChange={(v) => setLook({ navShowLogin: v })} label="Show the Login button" />
        </div>
        {/* Menu arrangement */}
        <FieldLabel>Menu items</FieldLabel>
        <p className="mb-2 text-[11px] text-slate-400">Rename any heading (its web address never changes), reorder, or group items into dropdowns.</p>
        <div className="flex flex-col gap-1.5">
          {navConfig.items.map((item, i) => (
            <div key={`${item.slug}-${i}`} className="rounded-lg border border-slate-200 p-2">
              <div className="flex items-center gap-1.5">
                <div className="flex flex-col">
                  <button type="button" aria-label={`Move ${item.label} up`} disabled={i === 0} onClick={() => moveMenu(i, -1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label={`Move ${item.label} down`} disabled={i === navConfig.items.length - 1} onClick={() => moveMenu(i, 1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>
                <Input aria-label={`Name of ${item.label}`} value={item.label} onChange={(e) => editMenu((items) => { items[i] = { ...items[i], label: e.target.value }; return items; })} className="h-8 flex-1 text-sm" />
                <span className="whitespace-nowrap text-[10px] text-slate-400">/{item.slug}</span>
                {item.children.length > 0 && (
                  <select aria-label={`What ${item.label} does`} value={item.behaviour} onChange={(e) => editMenu((items) => { items[i] = { ...items[i], behaviour: e.target.value as NavConfigItem['behaviour'] }; return items; })} className="rounded-md border border-slate-200 px-1.5 py-1 text-[11px]">
                    <option value="menu">Opens a menu</option><option value="page">Is a page too</option><option value="overview">Overview page</option>
                  </select>
                )}
                {item.children.length === 0 && navConfig.items.length > 1 && (
                  <select aria-label={`Move ${item.label} under another heading`} value="" onChange={(e) => e.target.value && demoteMenu(i, Number(e.target.value))} className="rounded-md border border-slate-200 px-1.5 py-1 text-[11px]">
                    <option value="">Move under…</option>
                    {navConfig.items.map((o, oi) => oi === i ? null : <option key={o.slug} value={oi}>{o.label}</option>)}
                  </select>
                )}
              </div>
              {item.children.length > 0 && (
                <ul className="mt-1.5 space-y-1 pl-6">
                  {item.children.map((child) => (
                    <li key={child.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span>{child.label}</span><span className="text-[10px] text-slate-400">({PAGE_LABELS[child.key] ?? child.key})</span>
                      <button type="button" aria-label={`Move ${child.label} out of ${item.label}`} onClick={() => promoteMenu(i, child.key)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"><CornerLeftUp className="h-3 w-3" /> Top-level</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setLook({ navConfig: defaultNavConfig() })} className="self-start text-[11px] font-semibold text-slate-500 hover:text-slate-700">Reset to the standard menu</button>
        </div>
      </Group>

      {/* ── Festive mode ── */}
      <Group id="festive" title="Festive mode" summary={festiveDef ? `${festiveDef.emoji} ${festiveDef.label}` : 'Off'}>
        <Chips options={[{ value: 'NONE', label: 'None' }, ...FESTIVALS.map((f) => ({ value: f.value, label: `${f.emoji} ${f.label}` }))]} value={festive?.festival ?? 'NONE'}
          onPick={(v) => setLook({ festiveTheme: v === 'NONE' ? null : { festival: v, variant: FESTIVALS.find((f) => f.value === v)?.variants[0].value, intensity: 'LAYER', ribbon: true, recolor: true } })} />
        {festive && festiveDef && (
          <>
            <FieldLabel>Decorations</FieldLabel>
            <Chips options={festiveDef.variants} value={festive.variant} onPick={(v) => setLook({ festiveTheme: { ...festive, variant: v } })} />
            <FieldLabel>Intensity</FieldLabel>
            <Chips options={[{ value: 'LAYER', label: 'Decorations layer' }, { value: 'FULL', label: 'Full takeover' }]} value={festive.intensity} onPick={(v) => setLook({ festiveTheme: { ...festive, intensity: v } })} />
            <div className="mt-2.5"><Toggle checked={festive.ribbon} onChange={(v) => setLook({ festiveTheme: { ...festive, ribbon: v } })} label="Greeting ribbon above the navbar" /></div>
            {festive.intensity === 'LAYER' && <div className="mt-1.5"><Toggle checked={festive.recolor} onChange={(v) => setLook({ festiveTheme: { ...festive, recolor: v } })} label="Festive accent colour" /></div>}
          </>
        )}
      </Group>

      {/* ── Footer ── */}
      <Group id="footer" title="Footer" summary={`${footer.layout.toLowerCase()} · ${footer.color.toLowerCase()}`}>
        <FieldLabel>Layout</FieldLabel>
        <Chips options={FOOTER_LAYOUTS} value={footer.layout} onPick={(v) => setLook({ footerConfig: { ...footer, layout: v } })} />
        <FieldLabel>Colour</FieldLabel>
        <Chips options={FOOTER_COLORS} value={footer.color} onPick={(v) => setLook({ footerConfig: { ...footer, color: v } })} />
        <div className="mt-2.5 flex flex-col gap-1.5">
          <Toggle checked={footer.social} onChange={(v) => setLook({ footerConfig: { ...footer, social: v } })} label="Show social icons" />
          <Toggle checked={footer.contact} onChange={(v) => setLook({ footerConfig: { ...footer, contact: v } })} label="Show contact details" />
          <Toggle checked={footer.twoCols} onChange={(v) => setLook({ footerConfig: { ...footer, twoCols: v } })} label="Split links into two columns" />
        </div>
        <FieldLabel>Tagline</FieldLabel>
        <Input value={footer.tagline ?? ''} maxLength={160} placeholder="Nurturing confident, compassionate lifelong learners." onChange={(e) => setLook({ footerConfig: { ...footer, tagline: e.target.value || null } })} className="h-9 text-sm" />
      </Group>

      {/* ── Custom pages ── */}
      <Group id="pages" title="Custom pages" summary={`${(pages.data ?? []).length} page${(pages.data ?? []).length === 1 ? '' : 's'}`}>
        {(pages.data ?? []).map((p) => (
          <div key={p.id} className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5">
            <span className="flex-1 text-sm font-semibold text-slate-700">{p.title}</span>
            <span className="text-[11px] text-slate-400">/p/{p.slug}</span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditingPage({ id: p.id, title: p.title, published: p.published, showInNav: p.showInNav !== false, blocks: ((p.blocks ?? []) as Block[]).filter((b) => b && (b.t in BLOCK_NAMES)) })}>Edit</Button>
            <button type="button" aria-label={`Delete ${p.title}`} className="text-xs text-rose-500 hover:text-rose-700" onClick={() => pageDelete.mutate(p.id)}>✕</button>
          </div>
        ))}
        {!editingPage && <Button size="sm" variant="outline" onClick={() => setEditingPage({ id: null, title: '', blocks: [{ t: 'h', text: '' }, { t: 'p', text: '' }], published: true, showInNav: true })}>+ New page</Button>}
        {editingPage && (
          <div className="flex flex-col gap-2.5 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
            <div><Label className="text-xs">Page title (its address is fixed on first save)</Label>
              <Input value={editingPage.title} maxLength={120} placeholder="Scholarships" onChange={(e) => setEditingPage({ ...editingPage, title: e.target.value })} className="mt-1 h-9 bg-white text-sm" /></div>
            {editingPage.blocks.map((b, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-white p-2">
                <div className="flex items-center gap-1">
                  <span className="flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{BLOCK_NAMES[b.t]}</span>
                  <button type="button" aria-label="Move up" disabled={i === 0} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveBlock(i, -1)}>▲</button>
                  <button type="button" aria-label="Move down" disabled={i === editingPage.blocks.length - 1} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => moveBlock(i, 1)}>▼</button>
                  <button type="button" aria-label="Remove block" className="px-1 text-xs text-rose-400 hover:text-rose-600" onClick={() => setEditingPage({ ...editingPage, blocks: editingPage.blocks.filter((_, j) => j !== i) })}>✕</button>
                </div>
                {(b.t === 'h' || b.t === 'cta') && <Input value={b.t === 'h' ? b.text : b.label} maxLength={b.t === 'h' ? 200 : 80} placeholder={b.t === 'h' ? 'Heading' : 'Button label'} onChange={(e) => editBlock(i, b.t === 'h' ? { text: e.target.value } : { label: e.target.value })} className="mt-1 h-8 text-sm" />}
                {(b.t === 'p' || b.t === 'imgtext') && <Textarea value={b.text} rows={2} placeholder="Write something…" onChange={(e) => editBlock(i, { text: e.target.value })} className="mt-1 text-sm" />}
                {(b.t === 'img' || b.t === 'imgtext') && (
                  <div className="mt-1 flex gap-1.5">
                    <Input value={b.url ?? ''} placeholder="https://… image URL" onChange={(e) => editBlock(i, { url: e.target.value })} className="h-8 flex-1 text-xs" />
                    {(galleryMedia.data ?? []).length > 0 && (
                      <select aria-label="Use a gallery photo" className="h-8 rounded-md border border-slate-200 text-xs text-slate-500" value="" onChange={(e) => e.target.value && editBlock(i, { url: e.target.value })}>
                        <option value="">Gallery…</option>{(galleryMedia.data ?? []).map((m, j) => <option key={m.id} value={m.url}>Photo {j + 1}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(BLOCK_NAMES) as Block['t'][]).map((t) => (
                <button key={t} type="button" disabled={editingPage.blocks.length >= 40} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40"
                  onClick={() => { if (editingPage.blocks.length >= 40) return; setEditingPage({ ...editingPage, blocks: [...editingPage.blocks, t === 'h' ? { t, text: '' } : t === 'p' ? { t, text: '' } : t === 'img' ? { t, url: '' } : t === 'imgtext' ? { t, url: null, text: '' } : { t, label: 'Learn more' }] }); }}>+ {BLOCK_NAMES[t]}</button>
              ))}
            </div>
            <Toggle checked={editingPage.published} onChange={(v) => setEditingPage({ ...editingPage, published: v })} label="Published (visible on your site)" />
            <Toggle checked={editingPage.showInNav} onChange={(v) => setEditingPage({ ...editingPage, showInNav: v })} label="Show in the navbar (off = footer only)" />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => pageMutation.mutate(editingPage)} disabled={!editingPage.title.trim() || pageMutation.isPending}>{pageMutation.isPending ? 'Saving…' : 'Save page'}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditingPage(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Group>

      {/* ── Custom code ── */}
      <Group id="code" title="Custom code" summary="CSS & HTML escape hatch">
        <p className="text-[11px] text-slate-400">Paste CSS scoped to one section, or an HTML block before the footer. Both are sanitized on save.</p>
        <FieldLabel>Section CSS</FieldLabel>
        <select value={cssSection} onChange={(e) => setCssSection(e.target.value)} className="mb-1.5 h-8 rounded-md border border-slate-200 text-xs text-slate-600">
          {['hero', ...SECTION_KEYS, 'footer', 'page'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <Textarea value={cssDrafts[cssSection] ?? ''} rows={4} spellCheck={false} placeholder={'.ps-panel { border: 2px dashed gold; }'} onChange={(e) => setCssDrafts({ ...cssDrafts, [cssSection]: e.target.value })} className="font-mono text-xs" />
        <Button size="sm" variant="outline" className="mt-1.5" onClick={() => codeMutation.mutate({ customSectionCss: cssDrafts })} disabled={codeMutation.isPending}>Save section CSS</Button>
        <FieldLabel>HTML block (before the footer)</FieldLabel>
        <Textarea value={htmlDraft} rows={3} spellCheck={false} placeholder='<div class="ps-panel" style="padding:1.5rem">…</div>' onChange={(e) => setHtmlDraft(e.target.value)} className="font-mono text-xs" />
        <p className="mt-1 text-[11px] text-slate-400">Appears on the preview after you save it (sanitized on the server first).</p>
        <Button size="sm" variant="outline" className="mt-1.5" onClick={() => codeMutation.mutate({ customHtmlBlock: htmlDraft })} disabled={codeMutation.isPending}>Save HTML block</Button>
      </Group>
    </div>
    </GroupCtx.Provider>
  );

  const preview = (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-none items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          <button type="button" aria-label="Desktop preview" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')} className={`px-2.5 py-1.5 ${device === 'desktop' ? 'bg-teal-50 text-teal-700' : 'text-slate-400'}`}><Monitor className="h-4 w-4" /></button>
          <button type="button" aria-label="Mobile preview" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')} className={`px-2.5 py-1.5 ${device === 'mobile' ? 'bg-teal-50 text-teal-700' : 'text-slate-400'}`}><Smartphone className="h-4 w-4" /></button>
        </div>
        <button type="button" onClick={reloadPreview} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"><RotateCw className="h-3.5 w-3.5" /> Reload</button>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> LIVE PREVIEW</span>
      </div>
      <div ref={previewBoxRef} className="min-h-0 h-[70vh] flex-1 lg:h-auto">
        {(() => {
          const logicalW = device === 'mobile' ? 390 : 1280;
          const scale = previewBox.w ? Math.min(1, previewBox.w / logicalW) : 1;
          return (
            <div
              className="mx-auto h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              style={{ width: Math.round(logicalW * scale) }}
            >
              <iframe
                ref={iframeRef}
                src="/preview"
                title="Live preview of your website"
                className="bg-white"
                style={{
                  width: logicalW,
                  height: previewBox.h ? Math.round(previewBox.h / scale) : '100%',
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  border: 0,
                }}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );

  return (
    <div>
      {/* Mobile/tablet: one pane at a time. */}
      <div className="sticky top-0 z-10 -mx-1 mb-3 flex gap-1 rounded-lg bg-white/90 p-1 shadow-sm backdrop-blur lg:hidden">
        {(['edit', 'preview'] as const).map((p) => (
          <button key={p} type="button" aria-pressed={mobilePane === p} onClick={() => setMobilePane(p)} className={['flex-1 rounded-md px-3 py-2 text-sm font-semibold capitalize', mobilePane === p ? 'bg-teal-600 text-white' : 'text-slate-500'].join(' ')}>{p === 'edit' ? 'Edit' : 'Preview'}</button>
        ))}
      </div>
      {/* Desktop: fixed-height two-pane. The rail scrolls INTERNALLY; the preview
          column is full-height and never moves, so it stays frozen while you
          work down the controls. */}
      <div className="lg:grid lg:h-[calc(100dvh-13rem)] lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] lg:gap-6">
        <div className={`lg:overflow-y-auto lg:pr-1 ${mobilePane === 'preview' ? 'hidden lg:block' : ''}`}>{rail}</div>
        <div className={`mt-4 lg:mt-0 lg:h-full ${mobilePane === 'edit' ? 'hidden lg:block' : ''}`}>{preview}</div>
      </div>
    </div>
  );
}
