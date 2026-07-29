'use client';
import ImageUploader from './image-uploader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SiteForm } from './site-form';

export default function BrandingTab({ form }: { form: SiteForm }) {
  const {
    data,
    brandColorPrimary,
    setBrandColorPrimary,
    brandColorSecondary,
    setBrandColorSecondary,
    logoPreviewUrl,
    isUploadingLogo,
    uploadLogo,
    brandingMutation,
  } = form;

  return (
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
  );
}
