import Link from 'next/link';
import '@/components/marketing/marketing.css';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

/**
 * The one navigation every sckools.com page that is NOT the static marketing
 * bundle wears: the website-builder landing page, the blog, the jobs board,
 * the about page.
 *
 * Before this there were four different menus across those pages (the blog
 * index linked "Website builder", posts linked "Blog", jobs linked only
 * "Pricing", the builder page had no Features at all), so a visitor who
 * entered through a blog post could not reach Features without guessing a
 * URL. Same links everywhere now; `variant` only marks the current section.
 *
 * "Request a callback" lands on the homepage with #callback, which the static
 * site turns into the open callback modal — the only place the modal lives.
 *
 * marketing.css is imported here on purpose so tenant blog pages (which never
 * render this component) do not ship it in their bundle.
 */
export type PlatformNavVariant = 'index' | 'post' | 'jobs' | 'job' | 'builder' | 'about' | 'earn';

const LINKS: { href: string; label: string; variants: PlatformNavVariant[] }[] = [
  { href: '/features', label: 'Features', variants: [] },
  { href: '/pricing', label: 'Pricing', variants: [] },
  { href: '/school-website-builder', label: 'Website builder', variants: ['builder'] },
  { href: '/blog', label: 'Blog', variants: ['index', 'post'] },
  { href: '/jobs', label: 'Jobs', variants: ['jobs', 'job'] },
  { href: '/about', label: 'About', variants: ['about'] },
  { href: '/earn', label: 'Refer & earn', variants: ['earn'] },
];

export default function PlatformBlogNav({ variant }: { variant: PlatformNavVariant }) {
  return (
    <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <Link href="/" className="logo" aria-label="Sckools home"><SckoolsLogo size={32} /></Link>
          {LINKS.map((l) => {
            const on = l.variants.includes(variant);
            return (
              <a key={l.href} className={`lnk${on ? ' on' : ''}`} href={l.href} aria-current={on ? 'page' : undefined}>
                {l.label}
              </a>
            );
          })}
          <Link className="btn btn-hot btn-sm mnav-cta" href="/#callback">Request a callback</Link>
        </div>
      </nav>
    </div>
  );
}
