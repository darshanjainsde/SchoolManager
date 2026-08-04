'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import PostsTab from './posts-tab';
import EditorTab, { type EditorTarget } from './editor-tab';
import LibraryTab from './library-tab';
import LayoutTab from './layout-tab';
import type { BlogPostRow, BlogSettings, LibraryPost, SelectionRow } from './types';

type Tab = 'posts' | 'editor' | 'library' | 'layout';

const TABS: { id: Tab; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'editor', label: 'Editor' },
  { id: 'library', label: 'Global Library' },
  { id: 'layout', label: 'Layout' },
];

export default function BlogPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [activeTab, setActiveTab] = useState<Tab>('posts');
  const [editingTarget, setEditingTarget] = useState<EditorTarget>(null);

  const postsQuery = useQuery({
    queryKey: ['blog-posts'],
    queryFn: () => api.get<BlogPostRow[]>('/cms/blog/posts'),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const libraryQuery = useQuery({
    queryKey: ['blog-library'],
    queryFn: () => api.get<LibraryPost[]>('/cms/blog/library'),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    enabled: !!host && activeTab === 'library',
  });

  const settingsQuery = useQuery({
    queryKey: ['blog-settings'],
    queryFn: () => api.get<BlogSettings>('/cms/blog/settings'),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    enabled: !!host && activeTab === 'layout',
  });

  const selectionsQuery = useQuery({
    queryKey: ['blog-selections'],
    queryFn: () => api.get<SelectionRow[]>('/cms/blog/selections'),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    enabled: !!host && activeTab === 'layout',
  });

  function handleEdit(post: BlogPostRow) {
    setEditingTarget(post);
    setActiveTab('editor');
  }

  function handleNew() {
    setEditingTarget('new');
    setActiveTab('editor');
  }

  function handleSaved(post: BlogPostRow) {
    setEditingTarget(post);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* `sk-pagehead` supplies the portal's serif heading — see /app/events. */}
      <header className="sk-pagehead" style={{ marginBottom: 0 }}>
        <h1>Blog</h1>
        <p>
          Write posts for your school blog, curate posts from the Sckools network, and arrange how your blog looks.
        </p>
      </header>

      <div className="flex border-b overflow-x-auto text-sm">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'sk-press px-4 py-2 border-b-2 whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'border-teal-600 text-teal-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* THE TAB BODY, WRAPPED AND KEYED ON THE TAB.
          Four tabs of a blog console look alike at a glance — a table of posts
          and a table of library posts are the same shape. `sk-wfade` is the
          pitch's answer to exactly that: the view fades and rises when the
          thing it shows is REPLACED, which is otherwise indistinguishable from
          "the click did nothing". The key is what re-runs it; the bodies
          already mount and unmount per tab, so nothing about their lifecycle
          changes. Reduced motion shows the new tab with no transition — the
          same content, arrived instantly. */}
      <div className="sk-wfade" key={activeTab}>
      {activeTab === 'posts' && <PostsTab postsQuery={postsQuery} onEdit={handleEdit} onNew={handleNew} />}
      {/* key: the editor seeds its fields from `target` at mount instead of
          syncing them in an effect, so switching post — or getting a fresh row
          back from a save — must remount it. `updatedAt` is what makes a save
          remount: the server may normalise the slug or status. */}
      {activeTab === 'editor' && (
        <EditorTab
          key={editingTarget && editingTarget !== 'new' ? `${editingTarget.id}:${editingTarget.updatedAt}` : 'new'}
          target={editingTarget}
          onSaved={handleSaved}
          onStartNew={handleNew}
        />
      )}
      {activeTab === 'library' && <LibraryTab libraryQuery={libraryQuery} />}
      {activeTab === 'layout' && <LayoutTab settingsQuery={settingsQuery} selectionsQuery={selectionsQuery} />}
      </div>
    </div>
  );
}
