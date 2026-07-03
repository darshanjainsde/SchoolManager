'use client';
import { useRef, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

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

// ── Constants ────────────────────────────────────────────────────────────────

const SOCIAL_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'LINKEDIN'] as const;

type Tab = 'branding' | 'homepage' | 'about' | 'contact' | 'gallery';

const TABS: { id: Tab; label: string }[] = [
  { id: 'branding', label: 'Branding' },
  { id: 'homepage', label: 'Homepage' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact & address' },
  { id: 'gallery', label: 'Gallery' },
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
  const api = useApi({ audience: 'school' });
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('branding');

  const { data, isLoading, error } = useQuery({
    queryKey: ['site-content'],
    queryFn: () => api.get<SiteContent>('/site/content'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Gallery query
  const galleryQuery = useQuery({
    queryKey: ['site-media-gallery'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=GALLERY'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: activeTab === 'gallery',
  });

  // ── Branding form state ────────────────────────────────────────────────────
  const [brandColorPrimary, setBrandColorPrimary] = useState('#000000');
  const [brandColorSecondary, setBrandColorSecondary] = useState('#ffffff');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

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

  // Seed all form state from fetched data; re-seeds if data is refetched
  useEffect(() => {
    if (!data) return;
    // Branding
    setBrandColorPrimary(data.profile.brandColorPrimary ?? '#000000');
    setBrandColorSecondary(data.profile.brandColorSecondary ?? '#ffffff');
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
              label="Hero image"
              hint="Wide landscape image for the homepage banner. Max 8 MB."
              previewUrl={heroPreviewUrl}
              hasExistingAsset={!!data?.homepage.heroAssetId}
              isUploading={isUploadingHero}
              onFile={uploadHero}
            />

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
