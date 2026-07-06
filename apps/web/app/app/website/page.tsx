'use client';
import { useRef, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  THEME_PRESETS,
  FONT_OPTIONS,
  HERO_OPTIONS,
  MOTION_OPTIONS,
} from '@/lib/theme-presets';
import CoursesTab from './courses-tab';
import AdmissionsTab from './admissions-tab';
import HallOfFameTab from './hof-tab';

const FONT_FAMILY: Record<string, string> = {
  INTER: "'Inter', sans-serif",
  FRAUNCES: "'Fraunces', serif",
  POPPINS: "'Poppins', sans-serif",
  NUNITO: "'Nunito', sans-serif",
};

// ── Local TS interfaces (web cannot import API types) ────────────────────────

interface SiteProfile {
  brandColorPrimary?: string | null;
  brandColorSecondary?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  mapEmbedUrl?: string | null;
  logoAssetId?: string | null;
  faviconAssetId?: string | null;
  headingFont?: string | null;
  heroStyle?: string | null;
  animationLevel?: string | null;
  themePreset?: string | null;
}

interface SiteHomepage {
  headline?: string | null;
  subheadline?: string | null;
  aboutText?: string | null;
  principalName?: string | null;
  principalMessage?: string | null;
  heroAssetId?: string | null;
  principalPhotoAssetId?: string | null;
}

interface StatRow {
  id?: string;
  label: string;
  value: string;
  order: number;
}

interface SocialLink {
  id?: string;
  platform: string;
  url: string;
  order: number;
}

interface SiteContent {
  profile: SiteProfile;
  homepage: SiteHomepage;
  stats: StatRow[];
  socialLinks: SocialLink[];
}

interface MediaAsset {
  id: string;
  kind: string;
  url: string;
  storageKey: string;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  photoAssetId?: string | null;
  order: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SOCIAL_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'LINKEDIN'] as const;

type Tab =
  | 'branding'
  | 'theme'
  | 'homepage'
  | 'about'
  | 'contact'
  | 'courses'
  | 'admissions'
  | 'hof'
  | 'gallery'
  | 'staff';

const TABS: { id: Tab; label: string }[] = [
  { id: 'branding', label: 'Branding' },
  { id: 'theme', label: 'Theme' },
  { id: 'homepage', label: 'Homepage' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact & address' },
  { id: 'courses', label: 'Courses' },
  { id: 'admissions', label: 'Admissions' },
  { id: 'hof', label: 'Hall of Fame' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'staff', label: 'Staff' },
];

// ── ImageUploader — reusable upload control ──────────────────────────────────

interface ImageUploaderProps {
  label: string;
  hint?: string;
  previewUrl?: string | null;
  hasExistingAsset?: boolean;
  isUploading: boolean;
  accept?: string;
  onFile: (file: File) => void;
}

function ImageUploader({
  label,
  hint,
  previewUrl,
  hasExistingAsset,
  isUploading,
  accept = 'image/*',
  onFile,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    // reset so the same file can be re-selected after an error
    e.target.value = '';
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}

      {/* Preview or placeholder */}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={label}
          className="h-24 w-auto rounded border border-slate-200 object-contain"
        />
      ) : hasExistingAsset ? (
        <p className="text-sm text-slate-500 italic">Current asset set — upload a new file to replace.</p>
      ) : (
        <p className="text-sm text-slate-400">No image set.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4 mr-1" />
        {isUploading ? 'Uploading…' : previewUrl || hasExistingAsset ? 'Replace image' : 'Upload image'}
      </Button>
    </div>
  );
}

// ── Page component ───────────────────────────────────────────────────────────

export default function WebsitePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('branding');

  const { data, isLoading, error } = useQuery({
    queryKey: ['site-content'],
    queryFn: () => api.get<SiteContent>('/site/content'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Wait for the tenant host — firing before it's set sends no X-Forwarded-Host
    // and the API rejects with "Tenant context required".
    enabled: !!host,
  });

  // Gallery query
  const galleryQuery = useQuery({
    queryKey: ['site-media-gallery'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=GALLERY'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host && activeTab === 'gallery',
  });

  // Staff queries
  const staffQuery = useQuery({
    queryKey: ['site-staff'],
    queryFn: () => api.get<StaffMember[]>('/site/staff'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host && activeTab === 'staff',
  });

  // Staff media query — used to resolve photo URLs from photoAssetId
  const staffMediaQuery = useQuery({
    queryKey: ['site-media-staff'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=STAFF'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host && activeTab === 'staff',
  });

  // ── Branding form state ────────────────────────────────────────────────────
  const [brandColorPrimary, setBrandColorPrimary] = useState('#000000');
  const [brandColorSecondary, setBrandColorSecondary] = useState('#ffffff');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // ── Theme form state ───────────────────────────────────────────────────────
  const [headingFont, setHeadingFont] = useState('INTER');
  const [heroStyle, setHeroStyle] = useState('ILLUSTRATION');
  const [animationLevel, setAnimationLevel] = useState('FULL');
  const [themePreset, setThemePreset] = useState('');

  // ── Homepage form state ────────────────────────────────────────────────────
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [stats, setStats] = useState<Array<{ label: string; value: string }>>([]);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [isUploadingHero, setIsUploadingHero] = useState(false);

  // ── About form state ───────────────────────────────────────────────────────
  const [aboutText, setAboutText] = useState('');
  const [principalName, setPrincipalName] = useState('');
  const [principalMessage, setPrincipalMessage] = useState('');

  // ── Contact form state ─────────────────────────────────────────────────────
  const [phone, setPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [mapEmbedUrl, setMapEmbedUrl] = useState('');
  const [socialLinks, setSocialLinks] = useState<Array<{ platform: string; url: string }>>([]);

  // ── Gallery upload state ───────────────────────────────────────────────────
  const galleryFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);

  // ── Staff form state ───────────────────────────────────────────────────────
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');
  const [newStaffPhotoAssetId, setNewStaffPhotoAssetId] = useState<string | null>(null);
  const [newStaffPhotoPreviewUrl, setNewStaffPhotoPreviewUrl] = useState<string | null>(null);
  const [isUploadingNewStaffPhoto, setIsUploadingNewStaffPhoto] = useState(false);
  // Edit state
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffName, setEditStaffName] = useState('');
  const [editStaffRole, setEditStaffRole] = useState('');
  const [editStaffPhotoAssetId, setEditStaffPhotoAssetId] = useState<string | null>(null);
  const [editStaffPhotoPreviewUrl, setEditStaffPhotoPreviewUrl] = useState<string | null>(null);
  const [isUploadingEditStaffPhoto, setIsUploadingEditStaffPhoto] = useState(false);

  // Seed all form state from fetched data; re-seeds if data is refetched
  useEffect(() => {
    if (!data) return;
    // Branding
    setBrandColorPrimary(data.profile.brandColorPrimary ?? '#000000');
    setBrandColorSecondary(data.profile.brandColorSecondary ?? '#ffffff');
    // Theme
    setHeadingFont(data.profile.headingFont ?? 'INTER');
    setHeroStyle(data.profile.heroStyle ?? 'ILLUSTRATION');
    setAnimationLevel(data.profile.animationLevel ?? 'FULL');
    setThemePreset(data.profile.themePreset ?? '');
    // Homepage
    setHeadline(data.homepage.headline ?? '');
    setSubheadline(data.homepage.subheadline ?? '');
    setStats(data.stats.map((s) => ({ label: s.label, value: s.value })));
    // About
    setAboutText(data.homepage.aboutText ?? '');
    setPrincipalName(data.homepage.principalName ?? '');
    setPrincipalMessage(data.homepage.principalMessage ?? '');
    // Contact
    setPhone(data.profile.phone ?? '');
    setContactEmail(data.profile.email ?? '');
    setAddressLine1(data.profile.addressLine1 ?? '');
    setAddressLine2(data.profile.addressLine2 ?? '');
    setCity(data.profile.city ?? '');
    setRegion(data.profile.region ?? '');
    setPostalCode(data.profile.postalCode ?? '');
    setCountry(data.profile.country ?? '');
    setMapEmbedUrl(data.profile.mapEmbedUrl ?? '');
    setSocialLinks(data.socialLinks.map((s) => ({ platform: s.platform, url: s.url })));
  }, [data]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const brandingMutation = useMutation({
    mutationFn: () =>
      api.put('/site/profile', { brandColorPrimary, brandColorSecondary }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Branding saved');
    },
    onError: (err: Error) => toast.error(`Failed to save branding: ${err.message}`),
  });

  const themeMutation = useMutation({
    mutationFn: () =>
      api.put('/site/profile', {
        brandColorPrimary,
        brandColorSecondary,
        headingFont,
        heroStyle,
        animationLevel,
        themePreset: themePreset || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Theme saved — reload your public site to see it');
    },
    onError: (err: Error) => toast.error(`Failed to save theme: ${err.message}`),
  });

  // Backdrop toggle in the Homepage tab — saves heroStyle immediately (only
  // that field) so admins don't have to discover the Theme tab for it.
  const backdropMutation = useMutation({
    mutationFn: (style: string) => api.put('/site/profile', { heroStyle: style }),
    onSuccess: (_data, style) => {
      setHeroStyle(style);
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success(
        style === 'PHOTO'
          ? 'Landing backdrop on — your photo now fills the landing screen'
          : 'Landing backdrop off — back to the illustrated hero',
      );
    },
    onError: (err: Error) => toast.error(`Failed to update backdrop: ${err.message}`),
  });

  // Apply a preset locally (does not save until "Save theme").
  const applyPreset = (key: string) => {
    const p = THEME_PRESETS[key];
    if (!p) return;
    setBrandColorPrimary(p.primary);
    setBrandColorSecondary(p.secondary);
    setHeadingFont(p.headingFont);
    setThemePreset(key);
  };

  const homepageMutation = useMutation({
    mutationFn: () =>
      Promise.all([
        api.put('/site/homepage', { headline, subheadline }),
        api.put('/site/stats', {
          items: stats.map((s, i) => ({ label: s.label, value: s.value, order: i })),
        }),
      ]),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Homepage saved');
    },
    onError: (err: Error) => toast.error(`Failed to save homepage: ${err.message}`),
  });

  const aboutMutation = useMutation({
    mutationFn: () =>
      api.put('/site/homepage', { aboutText, principalName, principalMessage }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('About section saved');
    },
    onError: (err: Error) => toast.error(`Failed to save about: ${err.message}`),
  });

  const contactMutation = useMutation({
    mutationFn: () =>
      Promise.all([
        api.put('/site/profile', {
          phone,
          email: contactEmail,
          addressLine1,
          addressLine2,
          city,
          region,
          postalCode,
          country,
          mapEmbedUrl,
        }),
        api.put('/site/social', {
          links: socialLinks.map((s, i) => ({ platform: s.platform, url: s.url, order: i })),
        }),
      ]),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Contact info saved');
    },
    onError: (err: Error) => toast.error(`Failed to save contact: ${err.message}`),
  });

  const galleryDeleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/site/media/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-media-gallery'] });
      toast.success('Image deleted');
    },
    onError: (err: Error) => toast.error(`Failed to delete image: ${err.message}`),
  });

  const addStaffMutation = useMutation({
    mutationFn: (member: { name: string; role: string; photoAssetId?: string | null; order: number }) =>
      api.post<StaffMember>('/site/staff', member),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-staff'] });
      setShowAddStaff(false);
      setNewStaffName('');
      setNewStaffRole('');
      setNewStaffPhotoAssetId(null);
      setNewStaffPhotoPreviewUrl(null);
      toast.success('Staff member added');
    },
    onError: (err: Error) => toast.error(`Failed to add staff: ${err.message}`),
  });

  const updateStaffMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; role: string; photoAssetId?: string | null; order: number }) =>
      api.put<StaffMember>(`/site/staff/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-staff'] });
      setEditingStaffId(null);
      toast.success('Staff member updated');
    },
    onError: (err: Error) => toast.error(`Failed to update staff: ${err.message}`),
  });

  const deleteStaffMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/site/staff/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-staff'] });
      toast.success('Staff member deleted');
    },
    onError: (err: Error) => toast.error(`Failed to delete staff: ${err.message}`),
  });

  // ── Upload handlers ────────────────────────────────────────────────────────

  async function uploadLogo(file: File) {
    setIsUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=LOGO', {
        method: 'POST',
        body: fd,
      });
      await api.put('/site/profile', { logoAssetId: asset.id });
      setLogoPreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Logo uploaded');
    } catch (err) {
      toast.error(`Logo upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingLogo(false);
    }
  }

  async function uploadHero(file: File) {
    setIsUploadingHero(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=HERO', {
        method: 'POST',
        body: fd,
      });
      await api.put('/site/homepage', { heroAssetId: asset.id });
      setHeroPreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Hero image uploaded');
    } catch (err) {
      toast.error(`Hero upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingHero(false);
    }
  }

  async function uploadGalleryImage(file: File) {
    setIsUploadingGallery(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.request<MediaAsset>('/site/media?kind=GALLERY', {
        method: 'POST',
        body: fd,
      });
      void queryClient.invalidateQueries({ queryKey: ['site-media-gallery'] });
      toast.success('Image added to gallery');
    } catch (err) {
      toast.error(`Gallery upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingGallery(false);
    }
  }

  async function uploadNewStaffPhoto(file: File) {
    setIsUploadingNewStaffPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=STAFF', {
        method: 'POST',
        body: fd,
      });
      setNewStaffPhotoAssetId(asset.id);
      setNewStaffPhotoPreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-media-staff'] });
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingNewStaffPhoto(false);
    }
  }

  async function uploadEditStaffPhoto(file: File) {
    setIsUploadingEditStaffPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=STAFF', {
        method: 'POST',
        body: fd,
      });
      setEditStaffPhotoAssetId(asset.id);
      setEditStaffPhotoPreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-media-staff'] });
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingEditStaffPhoto(false);
    }
  }

  // ── Stat row helpers ──────────────────────────────────────────────────────

  function addStat() {
    setStats((prev) => [...prev, { label: '', value: '' }]);
  }

  function removeStat(idx: number) {
    setStats((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateStat(idx: number, field: 'label' | 'value', val: string) {
    setStats((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  // ── Social link helpers ───────────────────────────────────────────────────

  function addSocialLink() {
    setSocialLinks((prev) => [...prev, { platform: 'FACEBOOK', url: '' }]);
  }

  function removeSocialLink(idx: number) {
    setSocialLinks((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateSocialLink(idx: number, field: 'platform' | 'url', val: string) {
    setSocialLinks((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Website content</h1>
        <p className="mt-1 text-sm text-slate-500">
          Edit what visitors see on your public site.
        </p>
      </header>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && (
        <p className="text-sm text-rose-600">{(error as Error).message}</p>
      )}

      {/* Tab bar */}
      <div className="flex border-b overflow-x-auto text-sm">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-4 py-2 border-b-2 whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'border-teal-600 text-teal-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── BRANDING TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'branding' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Brand colours &amp; logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Primary */}
              <div className="space-y-2">
                <Label htmlFor="color-primary">Primary colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="color-primary"
                    type="color"
                    value={brandColorPrimary}
                    onChange={(e) => setBrandColorPrimary(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-slate-300 p-0.5"
                  />
                  <Input
                    value={brandColorPrimary}
                    onChange={(e) => setBrandColorPrimary(e.target.value)}
                    placeholder="#000000"
                    className="font-mono"
                    maxLength={7}
                  />
                </div>
              </div>
              {/* Secondary */}
              <div className="space-y-2">
                <Label htmlFor="color-secondary">Secondary colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="color-secondary"
                    type="color"
                    value={brandColorSecondary}
                    onChange={(e) => setBrandColorSecondary(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-slate-300 p-0.5"
                  />
                  <Input
                    value={brandColorSecondary}
                    onChange={(e) => setBrandColorSecondary(e.target.value)}
                    placeholder="#ffffff"
                    className="font-mono"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            {/* Logo upload */}
            <ImageUploader
              label="School logo"
              hint="PNG or SVG recommended. Max 8 MB."
              previewUrl={logoPreviewUrl}
              hasExistingAsset={!!data?.profile.logoAssetId}
              isUploading={isUploadingLogo}
              onFile={uploadLogo}
            />
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => brandingMutation.mutate()}
              disabled={brandingMutation.isPending}
            >
              {brandingMutation.isPending ? 'Saving…' : 'Save branding'}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ── THEME TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'theme' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Theme &amp; style</CardTitle>
            <p className="text-sm text-slate-500">
              Choose how your public website looks. Pick a preset to start, then fine-tune.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Presets */}
            <div className="space-y-2">
              <Label>Preset</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(THEME_PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={[
                      'rounded-xl border p-3 text-left transition',
                      themePreset === key
                        ? 'border-teal-600 ring-2 ring-teal-100'
                        : 'border-slate-200 hover:border-slate-300',
                    ].join(' ')}
                  >
                    <div className="flex gap-1.5">
                      <span className="h-5 w-5 rounded-full" style={{ background: p.primary }} />
                      <span className="h-5 w-5 rounded-full" style={{ background: p.secondary }} />
                    </div>
                    <div className="mt-2 text-xs font-semibold capitalize">{key.toLowerCase()}</div>
                  </button>
                ))}
              </div>
              {themePreset === 'CUSTOM' && (
                <p className="text-xs text-slate-400">Custom — you&rsquo;ve tweaked the preset.</p>
              )}
            </div>

            {/* Colours (editing switches to Custom) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="theme-primary">Primary colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="theme-primary"
                    type="color"
                    value={brandColorPrimary}
                    onChange={(e) => { setBrandColorPrimary(e.target.value); setThemePreset('CUSTOM'); }}
                    className="h-10 w-14 cursor-pointer rounded border border-slate-300 p-0.5"
                  />
                  <Input
                    value={brandColorPrimary}
                    onChange={(e) => { setBrandColorPrimary(e.target.value); setThemePreset('CUSTOM'); }}
                    className="font-mono"
                    maxLength={7}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="theme-secondary">Accent colour</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="theme-secondary"
                    type="color"
                    value={brandColorSecondary}
                    onChange={(e) => { setBrandColorSecondary(e.target.value); setThemePreset('CUSTOM'); }}
                    className="h-10 w-14 cursor-pointer rounded border border-slate-300 p-0.5"
                  />
                  <Input
                    value={brandColorSecondary}
                    onChange={(e) => { setBrandColorSecondary(e.target.value); setThemePreset('CUSTOM'); }}
                    className="font-mono"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            {/* Font / Hero / Motion */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="space-y-2">
                <Label htmlFor="theme-font">Heading font</Label>
                <Select
                  id="theme-font"
                  value={headingFont}
                  onChange={(e) => { setHeadingFont(e.target.value); setThemePreset('CUSTOM'); }}
                >
                  {FONT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="theme-hero">Hero style</Label>
                <Select id="theme-hero" value={heroStyle} onChange={(e) => setHeroStyle(e.target.value)}>
                  {HERO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="theme-motion">Animation</Label>
                <Select id="theme-motion" value={animationLevel} onChange={(e) => setAnimationLevel(e.target.value)}>
                  {MOTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Live preview */}
            <div className="space-y-2">
              <Label>Preview</Label>
              <div
                className="rounded-2xl p-6 border"
                style={{ background: `${brandColorPrimary}0f`, borderColor: `${brandColorPrimary}33` }}
              >
                <div className="text-2xl font-bold" style={{ fontFamily: FONT_FAMILY[headingFont], color: brandColorPrimary }}>
                  {data?.homepage.headline || 'Your school headline'}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: brandColorPrimary }}>
                    Enquire
                  </span>
                  <span className="rounded-lg px-3 py-1.5 text-sm font-semibold" style={{ background: brandColorSecondary, color: '#14261d' }}>
                    Book a visit
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={() => themeMutation.mutate()} disabled={themeMutation.isPending}>
              {themeMutation.isPending ? 'Saving…' : 'Save theme'}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ── HOMEPAGE TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'homepage' && (
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
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={heroStyle === 'PHOTO'}
                disabled={backdropMutation.isPending || (!data?.homepage.heroAssetId && !heroPreviewUrl)}
                onChange={(e) => backdropMutation.mutate(e.target.checked ? 'PHOTO' : 'ILLUSTRATION')}
                className="mt-0.5 h-4 w-4 accent-emerald-700"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Use as full-screen landing backdrop
                </span>
                <span className="block text-xs text-slate-500">
                  Fills the whole first screen behind the homepage hero (saves immediately; same as the
                  &ldquo;Photo backdrop&rdquo; option in the Theme tab). Needs an image uploaded above.
                </span>
              </span>
            </label>

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
      )}

      {/* ── ABOUT TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'about' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>About &amp; principal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="about-text">About text</Label>
              <Textarea
                id="about-text"
                rows={6}
                value={aboutText}
                onChange={(e) => setAboutText(e.target.value)}
                placeholder="Tell visitors about your school's mission and culture…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="principal-name">Principal's name</Label>
              <Input
                id="principal-name"
                value={principalName}
                onChange={(e) => setPrincipalName(e.target.value)}
                placeholder="Dr. Jane Smith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="principal-message">Principal's message</Label>
              <Textarea
                id="principal-message"
                rows={5}
                value={principalMessage}
                onChange={(e) => setPrincipalMessage(e.target.value)}
                placeholder="A welcome message from the principal…"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => aboutMutation.mutate()}
              disabled={aboutMutation.isPending}
            >
              {aboutMutation.isPending ? 'Saving…' : 'Save about'}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ── CONTACT TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'contact' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Contact &amp; address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Phone + email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contact-phone">Phone</Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-email">Email</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="info@school.com"
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label htmlFor="addr1">Address line 1</Label>
              <Input
                id="addr1"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="42 Garden Avenue"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr2">Address line 2</Label>
              <Input
                id="addr2"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Suite 100 (optional)"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Bengaluru"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="region">State / Region</Label>
                <Input
                  id="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="Karnataka"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="postal-code">Postal code</Label>
                <Input
                  id="postal-code"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="560001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="India"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="map-embed" hint="Paste the src URL from a Google Maps embed code">
                Map embed URL
              </Label>
              <Input
                id="map-embed"
                value={mapEmbedUrl}
                onChange={(e) => setMapEmbedUrl(e.target.value)}
                placeholder="https://maps.google.com/maps?..."
              />
            </div>

            {/* Social links editor */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Social links</Label>
                <Button variant="outline" size="sm" onClick={addSocialLink}>
                  <Plus className="h-4 w-4" />
                  Add link
                </Button>
              </div>
              {socialLinks.length === 0 && (
                <p className="text-sm text-slate-400">No social links yet. Add one above.</p>
              )}
              {socialLinks.map((link, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select
                    value={link.platform}
                    onChange={(e) => updateSocialLink(idx, 'platform', e.target.value)}
                    className="w-36 shrink-0"
                  >
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0) + p.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={link.url}
                    onChange={(e) => updateSocialLink(idx, 'url', e.target.value)}
                    placeholder="https://…"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSocialLink(idx)}
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
              onClick={() => contactMutation.mutate()}
              disabled={contactMutation.isPending}
            >
              {contactMutation.isPending ? 'Saving…' : 'Save contact info'}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ── STAFF TAB ─────────────────────────────────────────────────────── */}
      {/* ── COURSES TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'courses' && <CoursesTab />}

      {/* ── ADMISSIONS TAB ────────────────────────────────────────────────── */}
      {activeTab === 'admissions' && <AdmissionsTab />}

      {/* ── HALL OF FAME TAB ──────────────────────────────────────────────── */}
      {activeTab === 'hof' && <HallOfFameTab />}

      {activeTab === 'staff' && (() => {
        // Build a lookup map: photoAssetId → url from the staff media list
        const staffPhotoUrlMap: Record<string, string> = {};
        for (const asset of staffMediaQuery.data ?? []) {
          staffPhotoUrlMap[asset.id] = asset.url;
        }
        return (
          <div className="space-y-6 max-w-4xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Featured staff</h2>
                <p className="text-sm text-slate-500">
                  Manage staff members displayed on your school website.
                </p>
              </div>
              <Button onClick={() => { setShowAddStaff((v) => !v); setEditingStaffId(null); }} variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                {showAddStaff ? 'Cancel' : 'Add staff'}
              </Button>
            </div>

            {/* Add staff form */}
            {showAddStaff && (
              <Card>
                <CardHeader>
                  <CardTitle>Add staff member</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-staff-name">Name</Label>
                    <Input
                      id="new-staff-name"
                      value={newStaffName}
                      onChange={(e) => setNewStaffName(e.target.value)}
                      placeholder="Dr. Jane Smith"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-staff-role">Role / Title</Label>
                    <Input
                      id="new-staff-role"
                      value={newStaffRole}
                      onChange={(e) => setNewStaffRole(e.target.value)}
                      placeholder="Principal"
                    />
                  </div>
                  <ImageUploader
                    label="Photo (optional)"
                    hint="Portrait photo. Max 8 MB."
                    previewUrl={newStaffPhotoPreviewUrl}
                    isUploading={isUploadingNewStaffPhoto}
                    onFile={uploadNewStaffPhoto}
                  />
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    onClick={() =>
                      addStaffMutation.mutate({
                        name: newStaffName,
                        role: newStaffRole,
                        photoAssetId: newStaffPhotoAssetId,
                        order: staffQuery.data?.length ?? 0,
                      })
                    }
                    disabled={addStaffMutation.isPending || !newStaffName.trim() || !newStaffRole.trim()}
                  >
                    {addStaffMutation.isPending ? 'Adding…' : 'Add member'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddStaff(false);
                      setNewStaffName('');
                      setNewStaffRole('');
                      setNewStaffPhotoAssetId(null);
                      setNewStaffPhotoPreviewUrl(null);
                    }}
                  >
                    Cancel
                  </Button>
                </CardFooter>
              </Card>
            )}

            {/* Staff list */}
            {staffQuery.isLoading && (
              <p className="text-sm text-slate-500">Loading staff…</p>
            )}
            {staffQuery.error && (
              <p className="text-sm text-rose-600">{(staffQuery.error as Error).message}</p>
            )}
            {staffQuery.data && staffQuery.data.length === 0 && !showAddStaff && (
              <p className="text-sm text-slate-400">
                No staff members yet. Click &quot;Add staff&quot; above.
              </p>
            )}
            {staffQuery.data && staffQuery.data.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {staffQuery.data.map((member) =>
                  editingStaffId === member.id ? (
                    /* Edit mode card */
                    <Card key={member.id}>
                      <CardHeader>
                        <CardTitle className="text-base">Edit staff member</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label>Name</Label>
                          <Input
                            value={editStaffName}
                            onChange={(e) => setEditStaffName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Role / Title</Label>
                          <Input
                            value={editStaffRole}
                            onChange={(e) => setEditStaffRole(e.target.value)}
                          />
                        </div>
                        <ImageUploader
                          label="Photo (optional)"
                          hint="Upload a new photo to replace the current one."
                          previewUrl={editStaffPhotoPreviewUrl}
                          hasExistingAsset={!!editStaffPhotoAssetId && !editStaffPhotoPreviewUrl}
                          isUploading={isUploadingEditStaffPhoto}
                          onFile={uploadEditStaffPhoto}
                        />
                      </CardContent>
                      <CardFooter className="gap-2">
                        <Button
                          onClick={() =>
                            updateStaffMutation.mutate({
                              id: member.id,
                              name: editStaffName,
                              role: editStaffRole,
                              photoAssetId: editStaffPhotoAssetId,
                              order: member.order,
                            })
                          }
                          disabled={
                            updateStaffMutation.isPending ||
                            !editStaffName.trim() ||
                            !editStaffRole.trim()
                          }
                        >
                          {updateStaffMutation.isPending ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingStaffId(null);
                            setEditStaffPhotoPreviewUrl(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </CardFooter>
                    </Card>
                  ) : (
                    /* View mode card */
                    <Card key={member.id}>
                      <CardContent className="flex items-start gap-4 pt-4">
                        {member.photoAssetId && staffPhotoUrlMap[member.photoAssetId] ? (
                          <img
                            src={staffPhotoUrlMap[member.photoAssetId]}
                            alt={member.name}
                            className="h-16 w-16 rounded-full object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="h-16 w-16 rounded-full bg-slate-200 flex items-center justify-center shrink-0 text-slate-600 text-xl font-semibold select-none">
                            {member.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{member.name}</p>
                          <p className="text-sm text-slate-500 truncate">{member.role}</p>
                          {member.photoAssetId && !staffPhotoUrlMap[member.photoAssetId] && (
                            <p className="text-xs text-slate-400 italic mt-1">Photo set</p>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="gap-2 pt-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowAddStaff(false);
                            setEditingStaffId(member.id);
                            setEditStaffName(member.name);
                            setEditStaffRole(member.role);
                            setEditStaffPhotoAssetId(member.photoAssetId ?? null);
                            setEditStaffPhotoPreviewUrl(null);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleteStaffMutation.isPending}
                          onClick={() => deleteStaffMutation.mutate(member.id)}
                          className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
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
      })()}

      {/* ── GALLERY TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'gallery' && (
        <div className="space-y-6 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle>Photo gallery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-500">
                Upload images to your public gallery. Images are displayed on your school website.
                Max 8 MB per image.
              </p>

              {/* Upload button */}
              <div>
                <input
                  ref={galleryFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadGalleryImage(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isUploadingGallery}
                  onClick={() => galleryFileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {isUploadingGallery ? 'Uploading…' : 'Upload image'}
                </Button>
              </div>

              {/* Gallery grid */}
              {galleryQuery.isLoading && (
                <p className="text-sm text-slate-500">Loading gallery…</p>
              )}
              {galleryQuery.error && (
                <p className="text-sm text-rose-600">
                  {(galleryQuery.error as Error).message}
                </p>
              )}
              {galleryQuery.data && galleryQuery.data.length === 0 && (
                <p className="text-sm text-slate-400">
                  No images in the gallery yet. Upload one above.
                </p>
              )}
              {galleryQuery.data && galleryQuery.data.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {galleryQuery.data.map((asset) => (
                    <div key={asset.id} className="relative group rounded overflow-hidden border border-slate-200">
                      <img
                        src={asset.url}
                        alt="Gallery image"
                        className="w-full aspect-square object-cover"
                      />
                      <button
                        onClick={() => galleryDeleteMutation.mutate(asset.id)}
                        disabled={galleryDeleteMutation.isPending}
                        aria-label="Delete image"
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
