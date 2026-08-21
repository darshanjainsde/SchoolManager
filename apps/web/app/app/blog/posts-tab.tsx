'use client';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { BlogPostRow } from './types';

function statusBadge(post: BlogPostRow) {
  return post.status === 'PUBLISHED' ? (
    <Badge tone="success">Published</Badge>
  ) : (
    <Badge tone="neutral">Draft</Badge>
  );
}

function globalBadge(post: BlogPostRow) {
  switch (post.globalStatus) {
    case 'APPROVED':
      return (
        <Badge tone="info">
          Approved{post.globalSlug ? ' · on network' : ''}
        </Badge>
      );
    case 'PENDING':
      return <Badge tone="warning">Pending review</Badge>;
    case 'REJECTED':
      return <Badge tone="danger" title={post.rejectReason ?? undefined}>Rejected</Badge>;
    case 'NONE':
    default:
      return <Badge tone="neutral">Not submitted</Badge>;
  }
}

export default function PostsTab({
  postsQuery,
  onEdit,
  onNew,
}: {
  postsQuery: UseQueryResult<BlogPostRow[]>;
  onEdit: (post: BlogPostRow) => void;
  onNew: () => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['blog-posts'] });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.post(`/cms/blog/posts/${id}/publish`),
    onSuccess: () => {
      invalidate();
      toast.success('Post published');
    },
    onError: (e: Error) => toast.error(`Publish failed: ${e.message}`),
  });

  const submitGlobalMutation = useMutation({
    mutationFn: (id: string) => api.post(`/cms/blog/posts/${id}/submit-global`),
    onSuccess: () => {
      invalidate();
      toast.success('Submitted for network review');
    },
    onError: (e: Error) => toast.error(`Submit failed: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/cms/blog/posts/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Post deleted');
    },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });

  function handlePublish(post: BlogPostRow) {
    if (!window.confirm(`Publish "${post.title}"? It will immediately become visible on your school blog.`)) return;
    publishMutation.mutate(post.id);
  }

  function handleSubmitGlobal(post: BlogPostRow) {
    if (
      !window.confirm(
        `Submit "${post.title}" for network syndication? An Sckools owner will review it before it appears on the shared sckools.com blog. This doesn't affect your own published post.`,
      )
    ) {
      return;
    }
    submitGlobalMutation.mutate(post.id);
  }

  function handleDelete(post: BlogPostRow) {
    if (!window.confirm(`Delete "${post.title}"? This can't be undone.`)) return;
    deleteMutation.mutate(post.id);
  }

  const posts = postsQuery.data ?? [];

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Your posts</h2>
          <p className="text-sm text-slate-500">Write, publish and share posts to the wider Sckools network.</p>
        </div>
        <Button onClick={onNew}>
          <Plus className="h-4 w-4 mr-1" />
          New post
        </Button>
      </div>

      {postsQuery.isLoading && <p className="text-sm text-slate-500">Loading posts…</p>}
      {postsQuery.error && <p className="text-sm text-rose-600">{(postsQuery.error as Error).message}</p>}
      {posts.length === 0 && !postsQuery.isLoading && (
        <p className="text-sm text-slate-400">No posts yet. Click &quot;New post&quot; to write your first one.</p>
      )}

      <div className="space-y-3">
        {posts.map((post) => (
          <Card key={post.id}>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-800 truncate">{post.title}</p>
                  {statusBadge(post)}
                  {globalBadge(post)}
                </div>
                <p className="mt-1 text-sm text-slate-500 truncate">
                  /{post.slug}
                  {post.publishedAt ? ` · Published ${new Date(post.publishedAt).toLocaleDateString()}` : ' · Not published'}
                </p>
                {post.globalStatus === 'REJECTED' && post.rejectReason && (
                  <p className="mt-1 text-xs text-rose-600">Reason: {post.rejectReason}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => onEdit(post)}>
                  Edit
                </Button>
                {post.status === 'DRAFT' && (
                  <Button size="sm" disabled={publishMutation.isPending} onClick={() => handlePublish(post)}>
                    Publish
                  </Button>
                )}
                {post.status === 'PUBLISHED' && post.globalStatus === 'NONE' && (
                  <Button variant="outline" size="sm" disabled={submitGlobalMutation.isPending} onClick={() => handleSubmitGlobal(post)}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Submit to network
                  </Button>
                )}
                {post.status === 'PUBLISHED' && post.globalStatus === 'REJECTED' && (
                  <Button variant="outline" size="sm" disabled={submitGlobalMutation.isPending} onClick={() => handleSubmitGlobal(post)}>
                    Resubmit
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => handleDelete(post)}
                  className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
