'use client';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { LibraryPost } from './types';

export default function LibraryTab({ libraryQuery }: { libraryQuery: UseQueryResult<LibraryPost[]> }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['blog-library'] });
    void queryClient.invalidateQueries({ queryKey: ['blog-selections'] });
  };

  const selectMutation = useMutation({
    mutationFn: (postId: string) => api.post('/cms/blog/selections', { postId }),
    onSuccess: () => {
      invalidate();
      toast.success('Added to your blog');
    },
    onError: (e: Error) => toast.error(`Select failed: ${e.message}`),
  });

  const unselectMutation = useMutation({
    mutationFn: (postId: string) => api.del(`/cms/blog/selections/${postId}`),
    onSuccess: () => {
      invalidate();
      toast.success('Removed from your blog');
    },
    onError: (e: Error) => toast.error(`Remove failed: ${e.message}`),
  });

  const posts = libraryQuery.data ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Global library</h2>
        <p className="text-sm text-slate-500">
          Posts approved for the shared Sckools network. Select any to feature on your own school blog.
        </p>
      </div>

      {libraryQuery.isLoading && <p className="text-sm text-slate-500">Loading library…</p>}
      {libraryQuery.error && <p className="text-sm text-rose-600">{(libraryQuery.error as Error).message}</p>}
      {posts.length === 0 && !libraryQuery.isLoading && (
        <p className="text-sm text-slate-400">No approved network posts yet — check back later.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {posts.map((post) => (
          <Card key={post.id}>
            <CardContent className="flex flex-col gap-2 py-4">
              <p className="font-semibold text-slate-800">{post.title}</p>
              <p className="text-sm text-slate-500 line-clamp-2">{post.description}</p>
              <p className="text-xs text-slate-400">
                {post.authorName ? `By ${post.authorName}` : 'Sckools'}
                {post.readMinutes ? ` · ${post.readMinutes} min read` : ''}
              </p>
              <div className="pt-1">
                {post.selected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unselectMutation.isPending}
                    onClick={() => unselectMutation.mutate(post.id)}
                  >
                    Unselect
                  </Button>
                ) : (
                  <Button size="sm" disabled={selectMutation.isPending} onClick={() => selectMutation.mutate(post.id)}>
                    Select for my blog
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
