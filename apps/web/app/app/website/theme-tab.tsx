'use client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

import { FONT_OPTIONS, MOTION_OPTIONS, THEME_PRESETS } from '@/lib/theme-presets';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FONT_FAMILY } from './types';
import type { SiteForm } from './site-form';

export default function ThemeTab({ form, onGoToDesign }: { form: SiteForm; onGoToDesign: () => void }) {
  const {
    data,
    brandColorPrimary,
    setBrandColorPrimary,
    brandColorSecondary,
    setBrandColorSecondary,
    headingFont,
    setHeadingFont,
    animationLevel,
    setAnimationLevel,
    themePreset,
    setThemePreset,
    applyPreset,
    themeMutation,
  } = form;

  return (
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
              <Label>First screen</Label>
              <button
                type="button"
                onClick={onGoToDesign}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-600 transition hover:border-slate-400"
              >
                Layout moved to the <span className="font-semibold text-teal-700">Design</span> tab →
              </button>
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
  );
}
