'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BlogBlock } from '@skoolos/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';
import BlogBlocks from '@/components/blog/BlogBlocks';
import '@/components/blog/blog.css';

// ── Types ──────────────────────────────────────────────────────────────────

/** Shape returned by GET /owner/blog/pending (blog-owner.service.ts#listPending). */
interface PendingPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  sections: BlogBlock[];
  publishedAt: string | null;
  updatedAt: string;
  schoolName: string | null;
  schoolSlug: string | null;
}

/** POST /owner/blog/:id/approve returns the full updated BlogPost row. */
interface ApproveResult {
  globalSlug: string | null;
}

const MIN_REASON_LENGTH = 10;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function BlogQueuePage() {
  // Session state, not the token itself — the refresh token is an HttpOnly
  // cookie the client cannot read.
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingPost | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-blog-pending'],
    queryFn: () => api.get<PendingPost[]>('/owner/blog/pending'),
    enabled: signedIn,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post<ApproveResult>(`/owner/blog/${id}/approve`),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['owner-blog-pending'] });
      toast.success(
        result.globalSlug
          ? `Approved — now live at sckools.com/blog/${result.globalSlug}`
          : 'Approved — now live on the global blog',
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/owner/blog/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-blog-pending'] });
      toast.success('Post rejected');
      setRejectTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleApprove(post: PendingPost) {
    if (
      !window.confirm(
        `Approve "${post.title}" by ${post.schoolName ?? 'this school'}? It will immediately go live on the global sckools.com blog.`,
      )
    ) {
      return;
    }
    approveMutation.mutate(post.id);
  }

  const rows = data ?? [];

  return (
    <div className="p-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Blog approval queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review posts schools have submitted for syndication on the shared sckools.com blog.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Pending review</CardTitle>
          <CardDescription>{rows.length} post{rows.length !== 1 ? 's' : ''} awaiting a decision</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
          {error && <div className="text-sm text-rose-600">{(error as Error).message}</div>}
          {!isLoading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing to review right now — schools submit posts here when they want them syndicated to the
              global sckools.com blog.
            </p>
          )}

          {!isLoading && rows.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {rows.map((post) => {
                const expanded = expandedId === post.id;
                const approving = approveMutation.isPending && approveMutation.variables === post.id;
                return (
                  <li key={post.id} className="py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{post.title}</p>
                          <Badge tone="warning">Pending review</Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          By <span className="font-medium">{post.schoolName ?? 'Unknown school'}</span>
                          {' · '}
                          Submitted {formatDate(post.updatedAt)}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{post.description}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExpandedId(expanded ? null : post.id)}
                        >
                          {expanded ? 'Hide preview' : 'Preview'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={approving || rejectMutation.isPending}
                          onClick={() => handleApprove(post)}
                        >
                          {approving ? 'Approving…' : 'Approve'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-rose-300 text-rose-700 hover:bg-rose-50"
                          disabled={approveMutation.isPending || rejectMutation.isPending}
                          onClick={() => setRejectTarget(post)}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                        <div className="blog">
                          <article className="blog-article">
                            <div className="wrap" style={{ maxWidth: 760 }}>
                              {post.heroImageUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  className="blog-article-hero"
                                  src={post.heroImageUrl}
                                  alt={post.title}
                                  width={1600}
                                  height={700}
                                  loading="lazy"
                                />
                              )}
                              <span className="blog-meta">{post.readMinutes} min read</span>
                              <h1>{post.title}</h1>
                              <p className="blog-byline">By {post.schoolName ?? 'this school'}</p>
                              <BlogBlocks blocks={post.sections} />
                            </div>
                          </article>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {rejectTarget && (
        <RejectDialog
          post={rejectTarget}
          pending={rejectMutation.isPending}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => rejectMutation.mutate({ id: rejectTarget.id, reason })}
        />
      )}
    </div>
  );
}

// ── Reject dialog ────────────────────────────────────────────────────────────

function RejectDialog({
  post,
  pending,
  onCancel,
  onConfirm,
}: {
  post: PendingPost;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REASON_LENGTH;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reject ${post.title}`}
      onClick={(e) => e.target === e.currentTarget && !pending && onCancel()}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Reject &ldquo;{post.title}&rdquo;</h2>
        <p className="mt-1 text-sm text-slate-500">
          Tell {post.schoolName ?? 'the school'} why this post isn&rsquo;t being syndicated. They&rsquo;ll see
          this reason and can revise and resubmit.
        </p>
        <div className="mt-4">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Needs a citation for the statistics in the second section."
            rows={4}
            disabled={pending}
          />
          {tooShort && reason.length > 0 && (
            <p className="mt-1 text-xs text-rose-600">
              At least {MIN_REASON_LENGTH} characters — give the school something actionable.
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending || tooShort}
            onClick={() => onConfirm(trimmed)}
          >
            {pending ? 'Rejecting…' : 'Reject post'}
          </Button>
        </div>
      </div>
    </div>
  );
}
