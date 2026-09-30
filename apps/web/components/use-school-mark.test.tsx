import { describe, it, expect, beforeEach } from 'vitest';
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
});
