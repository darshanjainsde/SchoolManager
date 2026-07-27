'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import BlockEditor from './block-editor';
import { validatePostFields, validateSections, SLUG_RE } from './validate';
import type { BlogBlock, BlogPostRow } from './types';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export type EditorTarget = BlogPostRow | 'new' | null;

export default function EditorTab({
  target,
  onSaved,
  onStartNew,
}: {
  target: EditorTarget;
  onSaved: (post: BlogPostRow) => void;
  onStartNew: () => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const editingPost = target && target !== 'new' ? target : null;
  const isPublished = editingPost?.status === 'PUBLISHED';

  // Seeded straight from the target, not synced by an effect. The parent
  // remounts this component per post (key={…}), so there is no stale-form case:
  // an effect keyed on the post id could not see a *refetched* post with the
  // same id, which left saved edits invisible until the tab was switched.
  const [title, setTitle] = useState(editingPost?.title ?? '');
  const [slug, setSlug] = useState(editingPost?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!editingPost);
  const [description, setDescription] = useState(editingPost?.description ?? '');
  const [heroImageUrl, setHeroImageUrl] = useState(editingPost?.heroImageUrl ?? '');
  const [readMinutes, setReadMinutes] = useState(editingPost?.readMinutes ?? 4);
  const [sections, setSections] = useState<BlogBlock[]>(editingPost?.sections ?? []);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched && !isPublished) {
      setSlug(slugify(value));
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        slug,
        heroImageUrl: heroImageUrl.trim() ? heroImageUrl.trim() : undefined,
        readMinutes,
        sections,
      };
      if (editingPost) {
        return api.patch<BlogPostRow>(`/cms/blog/posts/${editingPost.id}`, payload);
      }
      return api.post<BlogPostRow>('/cms/blog/posts', payload);
    },
    onSuccess: (post) => {
      void queryClient.invalidateQueries({ queryKey: ['blog-posts'] });
      toast.success(editingPost ? 'Post saved' : 'Draft created');
      onSaved(post);
    },
    onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
  });

  function handleSave() {
    const fieldErrors = validatePostFields({ title, description, slug, heroImageUrl, readMinutes });
    const sectionsError = validateSections(sections);
    const errors = [...fieldErrors, ...(sectionsError ? [sectionsError] : [])];
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    saveMutation.mutate();
  }

  if (target === null) {
    return (
      <div className="max-w-2xl space-y-3">
        <p className="text-sm text-slate-400">
          Select a post from &quot;Posts&quot; to edit it, or start a new one.
        </p>
        <Button onClick={onStartNew}>New post</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingPost ? 'Edit post' : 'New post'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="post-title" required>
              Title
            </Label>
            <Input
              id="post-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="5 things every school leader should know about…"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="post-slug"
              hint={
                isPublished
                  ? 'Locked — the URL slug cannot change after a post is published.'
                  : `Lowercase letters, numbers and hyphens only (3–80 chars). Matches ${SLUG_RE.source}`
              }
            >
              Slug
            </Label>
            <Input
              id="post-slug"
              value={slug}
              disabled={isPublished}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              placeholder="5-things-school-leaders-should-know"
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="post-description" required hint="Shown on the post card and used as the meta description (max 200 chars).">
              Description
            </Label>
            <Textarea
              id="post-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="post-hero" hint="https:// URL, or a path starting with a single &quot;/&quot; (e.g. from your media gallery). Optional.">
                Hero image URL
              </Label>
              <Input
                id="post-hero"
                value={heroImageUrl}
                onChange={(e) => setHeroImageUrl(e.target.value)}
                placeholder="https://… or /media/…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="post-read-minutes">Read time (minutes)</Label>
              <Input
                id="post-read-minutes"
                type="number"
                min={1}
                max={60}
                value={readMinutes}
                onChange={(e) => setReadMinutes(Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
          <p className="text-sm text-slate-500">Build the post from blocks — reorder with the arrows, remove with the trash icon.</p>
        </CardHeader>
        <CardContent>
          <BlockEditor blocks={sections} onChange={setSections} />
        </CardContent>
        <CardFooter>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save post'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
