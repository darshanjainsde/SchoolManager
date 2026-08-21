'use client';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MediaAsset } from './types';

/**
 * Gallery tab — self-contained: it owns its query, its uploads and its delete.
 * It mounts only while the tab is open, which is what used to be expressed as
 * `enabled: activeTab === 'gallery'` on the query.
 */
export default function GalleryTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const galleryFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);

  const galleryQuery = useQuery({
    queryKey: ['site-media-gallery'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=GALLERY'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const galleryDeleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/site/media/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-media-gallery'] });
      toast.success('Image deleted');
    },
    onError: (err: Error) => toast.error(`Failed to delete image: ${err.message}`),
  });

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

  return (
      <div className="space-y-6 w-full">
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
  );
}
