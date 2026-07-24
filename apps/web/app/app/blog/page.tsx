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
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Blog</h1>
        <p className="mt-1 text-sm text-slate-500">
          Write posts for your school blog, curate posts from the Sckools network, and arrange how your blog looks.
        </p>
      </header>

      <div className="flex border-b overflow-x-auto text-sm">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-4 py-2 border-b-2 whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'border-teal-600 text-teal-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'posts' && <PostsTab postsQuery={postsQuery} onEdit={handleEdit} onNew={handleNew} />}
      {activeTab === 'editor' && <EditorTab target={editingTarget} onSaved={handleSaved} onStartNew={handleNew} />}
      {activeTab === 'library' && <LibraryTab libraryQuery={libraryQuery} />}
      {activeTab === 'layout' && <LayoutTab settingsQuery={settingsQuery} selectionsQuery={selectionsQuery} />}
    </div>
  );
}
