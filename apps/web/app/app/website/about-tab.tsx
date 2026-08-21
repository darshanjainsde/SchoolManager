'use client';
import ImageUploader from './image-uploader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SiteForm } from './site-form';

export default function AboutTab({ form }: { form: SiteForm }) {
  const {
    data,
    aboutText,
    setAboutText,
    principalName,
    setPrincipalName,
    principalMessage,
    setPrincipalMessage,
    aboutMutation,
    aboutImagePreviewUrl,
    isUploadingAboutImage,
    uploadAboutImage,
    principalPhotoPreviewUrl,
    isUploadingPrincipalPhoto,
    uploadPrincipalPhoto,
  } = form;

  return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>About &amp; principal</CardTitle>
        </CardHeader>
        {/* Two columns on wide screens: the words on the left, the imagery on
            the right. */}
        <CardContent>
          <div className="grid gap-x-10 gap-y-5 lg:grid-cols-2">
          <div className="space-y-5">
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
          </div>
          <div className="space-y-5">
          <ImageUploader
            label="About image"
            hint="Wide photo shown beside the About text (campus, classrooms, community). Saves immediately. Max 4 MB."
            previewUrl={aboutImagePreviewUrl}
            hasExistingAsset={!!data?.homepage.aboutImageAssetId}
            isUploading={isUploadingAboutImage}
            onFile={uploadAboutImage}
          />
          <ImageUploader
            label="Principal photo"
            hint="Portrait shown in the small name card over the About image. Saves immediately. Max 4 MB."
            previewUrl={principalPhotoPreviewUrl}
            hasExistingAsset={!!data?.homepage.principalPhotoAssetId}
            isUploading={isUploadingPrincipalPhoto}
            onFile={uploadPrincipalPhoto}
          />
          </div>
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
  );
}
