import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSchoolMark } from './use-school-mark';

/**
 * The school's mark in the tab, set from the client.
 *
 * Measured on production 2026-09-30: eleven routes served on a school's own
 * address showed OUR Tassel-S. The server route to fixing it — a
 * `generateMetadata` in each layout — is closed, because those layouts are
 * client components and splitting them made /app, /portal and /teacher fall
 * from prerendered to dynamic. So the icon is swapped after hydration, and
 * these are the properties that keeps honest.
 */
const icons = () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')).map((l) => l.getAttribute('href'));

beforeEach(() => { document.head.innerHTML = ''; });

describe('useSchoolMark', () => {
  it('replaces every icon link, not just the first', () => {
    document.head.innerHTML = '<link rel="icon" href="/icon.svg"><link rel="shortcut icon" href="/favicon.ico">';
    renderHook(() => useSchoolMark('https://cdn/school.png'));
    // Leaving one behind means the browser can still choose ours.
    expect(icons()).toEqual(['https://cdn/school.png', 'https://cdn/school.png']);
  });

  it('creates one when the document has none', () => {
    renderHook(() => useSchoolMark('https://cdn/school.png'));
    expect(icons()).toEqual(['https://cdn/school.png']);
  });

  it('leaves the platform mark alone when the school has none', () => {
    document.head.innerHTML = '<link rel="icon" href="/icon.svg">';
    renderHook(() => useSchoolMark(null));
    // Better our mark than a broken image — null is a real answer, not a gap.
    expect(icons()).toEqual(['/icon.svg']);
    renderHook(() => useSchoolMark(undefined));
    expect(icons()).toEqual(['/icon.svg']);
  });

  it('puts the platform mark back on unmount, so signing out does not leave a crest behind', () => {
    document.head.innerHTML = '<link rel="icon" href="/icon.svg">';
    const { unmount } = renderHook(() => useSchoolMark('https://cdn/school.png'));
    expect(icons()).toEqual(['https://cdn/school.png']);
    unmount();
    expect(icons()).toEqual(['/icon.svg']);
  });

  it('removes a link it created itself rather than leaving an empty one', () => {
    const { unmount } = renderHook(() => useSchoolMark('https://cdn/school.png'));
    unmount();
    expect(icons()).toEqual([]);
  });

  it('drops the platform link\'s declared type and size, which describe the OLD file', () => {
    // Next emits <link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">. Swapping only the href left
    // type="image/svg+xml" on a PNG logo, and the browser — told it was an SVG — failed to draw it and kept the
    // Tassel-S in the tab (seen on a school's admin console, 2026-10-02).
    document.head.innerHTML = '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">';
    renderHook(() => useSchoolMark('https://cdn/school.png'));
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!;
    expect(link.getAttribute('href')).toBe('https://cdn/school.png');
    expect(link.hasAttribute('type')).toBe(false);
    expect(link.hasAttribute('sizes')).toBe(false);
  });

  it('puts the declared type and size back with the platform mark on unmount', () => {
    document.head.innerHTML = '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">';
    const { unmount } = renderHook(() => useSchoolMark('https://cdn/school.png'));
    unmount();
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!;
    expect(link.getAttribute('href')).toBe('/icon.svg');
    expect(link.getAttribute('type')).toBe('image/svg+xml');
    expect(link.getAttribute('sizes')).toBe('any');
  });

  it('puts the crest back when the framework rewrites the head on a route change', async () => {
    // THE REPORTED BUG. Next's App Router re-renders <head> on every client
    // navigation, so each route contributes its own <link rel="icon"> and the
    // ones this hook rewrote are REPLACED by fresh ones pointing at the
    // Tassel-S. The effect does not re-run — the url has not changed — so the
    // platform's mark stayed in the tab until a full reload. The owner's
    // words: "whenever i change tab or anything the school logo replaces by
    // sckools logo and upon reload the actual school logo comes back".
    document.head.innerHTML = '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">';
    renderHook(() => useSchoolMark('https://cdn/school.png'));
    expect(icons()).toEqual(['https://cdn/school.png']);

    // What a route change does: the old link goes, a brand-new one arrives.
    document.head.innerHTML = '<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">';
    await new Promise((r) => setTimeout(r, 0));

    expect(icons()).toEqual(['https://cdn/school.png']);
    expect(document.querySelector('link[rel~="icon"]')!.hasAttribute('type')).toBe(false);
  });

  it('stops watching once the shell unmounts, so the platform keeps its own mark', async () => {
    document.head.innerHTML = '<link rel="icon" href="/icon.svg">';
    const { unmount } = renderHook(() => useSchoolMark('https://cdn/school.png'));
    unmount();
    document.head.innerHTML = '<link rel="icon" href="/icon.svg">';
    await new Promise((r) => setTimeout(r, 0));
    expect(icons()).toEqual(['/icon.svg']);
  });

  it('does not fight a head that already carries the crest', async () => {
    // The observer must not rewrite what is already right, or every one of its
    // own writes would wake it again.
    document.head.innerHTML = '<link rel="icon" href="https://cdn/school.png">';
    renderHook(() => useSchoolMark('https://cdn/school.png'));
    const link = document.querySelector('link[rel~="icon"]')!;
    const spy = vi.spyOn(link, 'setAttribute');
    document.head.appendChild(document.createElement('meta'));
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
  });
});

