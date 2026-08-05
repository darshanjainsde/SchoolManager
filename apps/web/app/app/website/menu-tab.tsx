'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, CornerDownRight, CornerLeftUp } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  defaultNavConfig,
  validateNavConfig,
  type NavConfig,
  type NavConfigItem,
} from '@/components/public/sections/nav-config';

/**
 * The school's own menu.
 *
 * Reordering is arrow buttons rather than pointer dragging, matching the
 * gallery tab's existing "move image left/right": a keyboard reaches it, a
 * screen reader announces it, and it is testable. Pointer dragging can be laid
 * on top later without changing anything below it.
 *
 * Nothing here decides the RULES — `validateNavConfig` owns those, so the
 * public site and this editor can never disagree about what is allowed.
 */
const PAGE_LABELS: Record<string, string> = {
  about: 'About',
  hof: 'Hall of Fame',
  gallery: 'Gallery',
  academics: 'Academics',
  admissions: 'Admissions',
  connect: 'Connect',
  blog: 'Blog',
  contact: 'Contact',
};

interface SiteContent {
  profile?: { navConfig?: NavConfig | null } | null;
  school?: { features?: string[] } | null;
  courses?: unknown[];
}

/** Which pages this school actually has, so it is never told it lost one it never had. */
function availablePages(content: SiteContent | undefined): string[] {
  const features = content?.school?.features ?? [];
  const has: Record<string, boolean> = {
    about: true,
    hof: true,
    gallery: features.includes('GALLERY'),
    academics: (content?.courses?.length ?? 0) > 0,
    admissions: true,
    connect: features.includes('EVENTS'),
    blog: features.includes('BLOG'),
    contact: true,
  };
  return Object.keys(has).filter((k) => has[k]);
}

export default function MenuTab() {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();

  const { data: content } = useQuery<SiteContent>({
    queryKey: ['site-content'],
    queryFn: () => api.get('/site/content'),
    enabled: !!host,
  });

  const saved = content?.profile?.navConfig ?? null;
  const [draft, setDraft] = useState<NavConfig | null>(null);
  const config = draft ?? saved ?? defaultNavConfig();
  const pages = useMemo(() => availablePages(content), [content]);
  const check = useMemo(() => validateNavConfig(config, pages), [config, pages]);
  const dirty = draft !== null;

  const save = useMutation({
    mutationFn: (next: NavConfig) => api.put('/site/profile', { navConfig: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-content'] });
      setDraft(null);
      toast.success('Menu saved — reload your public site to see it');
    },
    onError: (err: Error) => toast.error(`Could not save the menu: ${err.message}`),
  });

  const edit = (fn: (items: NavConfigItem[]) => NavConfigItem[]) =>
    setDraft({ items: fn(config.items.map((i) => ({ ...i, children: [...i.children] }))) });

  const move = (index: number, by: number) =>
    edit((items) => {
      const to = index + by;
      if (to < 0 || to >= items.length) return items;
      const [row] = items.splice(index, 1);
      items.splice(to, 0, row);
      return items;
    });

  /** Out of a group is TOP-LEVEL, never invisible. */
  const promote = (itemIndex: number, childKey: string) =>
    edit((items) => {
      const item = items[itemIndex];
      const child = item.children.find((c) => c.key === childKey);
      if (!child) return items;
      item.children = item.children.filter((c) => c.key !== childKey);
      items.push({ key: child.key, slug: child.key, label: child.label, behaviour: 'page', children: [] });
      return items.filter((i) => i.behaviour !== 'menu' || i.children.length > 0);
    });

  const demote = (itemIndex: number, intoIndex: number) =>
    edit((items) => {
      const item = items[itemIndex];
      const into = items[intoIndex];
      if (!item || !into || item === into) return items;
      into.children.push({ key: item.key, label: item.label });
      return items.filter((_, i) => i !== itemIndex);
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Menu</CardTitle>
          <p className="text-sm text-slate-500">
            The order visitors see, and what sits under each heading. You can rename any heading; its web address
            never changes, so links people have already shared keep working.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {config.items.map((item, i) => (
            <div key={`${item.slug}-${i}`} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={`Move ${item.label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={i === config.items.length - 1}
                    onClick={() => move(i, 1)}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
                <Input
                  aria-label={`Name of ${item.label}`}
                  value={item.label}
                  onChange={(e) =>
                    edit((items) => {
                      items[i] = { ...items[i], label: e.target.value };
                      return items;
                    })
                  }
                  className="max-w-xs"
                />
                {/* Shown, not hidden: an admin renaming a heading should see
                    that the address is staying put, rather than discover it. */}
                <span className="whitespace-nowrap text-xs text-slate-400">/{item.slug}</span>
                {item.children.length > 0 && (
                  <select
                    aria-label={`What ${item.label} does`}
                    value={item.behaviour}
                    onChange={(e) =>
                      edit((items) => {
                        items[i] = { ...items[i], behaviour: e.target.value as NavConfigItem['behaviour'] };
                        return items;
                      })
                    }
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="menu">Opens a menu</option>
                    <option value="page">Is a page too</option>
                    <option value="overview">Has an overview page</option>
                  </select>
                )}
                {item.children.length === 0 && config.items.length > 1 && (
                  <select
                    aria-label={`Move ${item.label} under another heading`}
                    value=""
                    onChange={(e) => e.target.value && demote(i, Number(e.target.value))}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">Move under…</option>
                    {config.items.map((other, oi) =>
                      oi === i ? null : (
                        <option key={other.slug} value={oi}>
                          {other.label}
                        </option>
                      ),
                    )}
                  </select>
                )}
              </div>

              {item.children.length > 0 && (
                <ul className="mt-2 space-y-1 pl-8">
                  {item.children.map((child) => (
                    <li key={child.key} className="flex items-center gap-2 text-sm text-slate-600">
                      <CornerDownRight className="h-3.5 w-3.5 text-slate-300" />
                      <span>{child.label}</span>
                      <span className="text-xs text-slate-400">({PAGE_LABELS[child.key] ?? child.key})</span>
                      <button
                        type="button"
                        aria-label={`Move ${child.label} out of ${item.label}`}
                        onClick={() => promote(i, child.key)}
                        className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                      >
                        <CornerLeftUp className="h-3.5 w-3.5" /> Make top-level
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {check.errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">This menu cannot be saved yet</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {check.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button disabled={!dirty || !check.ok || save.isPending} onClick={() => save.mutate(config)}>
          {save.isPending ? 'Saving…' : 'Save menu'}
        </Button>
        <Button variant="outline" disabled={!dirty} onClick={() => setDraft(null)}>
          Discard changes
        </Button>
        <Button variant="ghost" onClick={() => setDraft(defaultNavConfig())}>
          Reset to the standard menu
        </Button>
      </div>
    </div>
  );
}
