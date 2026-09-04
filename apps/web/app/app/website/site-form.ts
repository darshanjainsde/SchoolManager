'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { THEME_PRESETS } from '@/lib/theme-presets';
import type { MediaAsset, SiteContent, SiteHomepage } from './types';

/**
 * The website console's shared settings form: one fetch of /site/content, the
 * field state seeded from it, and the mutations/uploads that write it back.
 * Branding, Theme, Homepage, About and Contact are five views onto this one
 * form — they are separate tabs, not separate documents, which is why the
 * state lives here rather than in each tab.
 *
 * Gallery and Staff are NOT here: they own their own queries and mount only
 * when their tab is open (see gallery-tab.tsx / staff-tab.tsx).
 */
export function useSiteForm() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['site-content'],
    queryFn: () => api.get<SiteContent>('/site/content'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Wait for the tenant host — firing before it's set sends no X-Forwarded-Host
    // and the API rejects with "Tenant context required".
    enabled: !!host,
  });

  // ── Branding form state ────────────────────────────────────────────────────
  const [brandColorPrimary, setBrandColorPrimary] = useState('#000000');
  const [brandColorSecondary, setBrandColorSecondary] = useState('#ffffff');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // ── Theme form state ───────────────────────────────────────────────────────
  const [headingFont, setHeadingFont] = useState('INTER');
  const [animationLevel, setAnimationLevel] = useState('FULL');
  const [themePreset, setThemePreset] = useState('');

  // ── Homepage form state ────────────────────────────────────────────────────
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [stats, setStats] = useState<Array<{ label: string; value: string }>>([]);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [isUploadingHero, setIsUploadingHero] = useState(false);
  const [aboutImagePreviewUrl, setAboutImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingAboutImage, setIsUploadingAboutImage] = useState(false);
  const [principalPhotoPreviewUrl, setPrincipalPhotoPreviewUrl] = useState<string | null>(null);
  const [isUploadingPrincipalPhoto, setIsUploadingPrincipalPhoto] = useState(false);

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
  const [board, setBoard] = useState('');
  const [affiliationNo, setAffiliationNo] = useState('');
  const [socialLinks, setSocialLinks] = useState<Array<{ platform: string; url: string }>>([]);

  // Seed all form state from fetched data; re-seeds if data is refetched
  useEffect(() => {
    if (!data) return;
    // Branding
    setBrandColorPrimary(data.profile.brandColorPrimary ?? '#000000');
    setBrandColorSecondary(data.profile.brandColorSecondary ?? '#ffffff');
    // Theme
    setHeadingFont(data.profile.headingFont ?? 'INTER');
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
    setBoard(data.profile.board ?? '');
    setAffiliationNo(data.profile.affiliationNo ?? '');
    setSocialLinks(data.socialLinks.map((s) => ({ platform: s.platform, url: s.url })));
  }, [data]);

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
        animationLevel,
        themePreset: themePreset || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Theme saved — reload your public site to see it');
    },
    onError: (err: Error) => toast.error(`Failed to save theme: ${err.message}`),
  });

  // Homepage-section visibility — instant-save toggles. Full details always
  // stay available on the dedicated public pages.
  const sectionToggleMutation = useMutation({
    mutationFn: (patch: Partial<SiteHomepage>) => api.put('/site/homepage', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Homepage sections updated');
    },
    onError: (err: Error) => toast.error(`Failed to update sections: ${err.message}`),
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
          board,
          affiliationNo,
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

  async function uploadAboutImage(file: File) {
    setIsUploadingAboutImage(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=ABOUT', { method: 'POST', body: fd });
      await api.put('/site/homepage', { aboutImageAssetId: asset.id });
      setAboutImagePreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('About image uploaded');
    } catch (err) {
      toast.error(`About image upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingAboutImage(false);
    }
  }

  async function uploadPrincipalPhoto(file: File) {
    setIsUploadingPrincipalPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=PRINCIPAL', { method: 'POST', body: fd });
      await api.put('/site/homepage', { principalPhotoAssetId: asset.id });
      setPrincipalPhotoPreviewUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      toast.success('Principal photo uploaded');
    } catch (err) {
      toast.error(`Principal photo upload failed: ${(err as Error).message}`);
    } finally {
      setIsUploadingPrincipalPhoto(false);
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

  return {
    // data
    data, isLoading, error,
    // branding
    brandColorPrimary, setBrandColorPrimary, brandColorSecondary, setBrandColorSecondary,
    logoPreviewUrl, isUploadingLogo, uploadLogo, brandingMutation,
    // theme
    headingFont, setHeadingFont, animationLevel, setAnimationLevel,
    themePreset, setThemePreset, applyPreset, themeMutation,
    // homepage
    headline, setHeadline, subheadline, setSubheadline,
    stats, addStat, removeStat, updateStat,
    heroPreviewUrl, isUploadingHero, uploadHero,
    sectionToggleMutation, homepageMutation,
    // about
    aboutText, setAboutText, principalName, setPrincipalName,
    principalMessage, setPrincipalMessage, aboutMutation,
    aboutImagePreviewUrl, isUploadingAboutImage, uploadAboutImage,
    principalPhotoPreviewUrl, isUploadingPrincipalPhoto, uploadPrincipalPhoto,
    // contact
    phone, setPhone, contactEmail, setContactEmail,
    addressLine1, setAddressLine1, addressLine2, setAddressLine2,
    city, setCity, region, setRegion, postalCode, setPostalCode, country, setCountry,
    mapEmbedUrl, setMapEmbedUrl,
    board, setBoard, affiliationNo, setAffiliationNo,
    socialLinks, addSocialLink, removeSocialLink, updateSocialLink, contactMutation,
  };
}

/** Everything the five field tabs (branding/theme/homepage/about/contact) share. */
export type SiteForm = ReturnType<typeof useSiteForm>;
