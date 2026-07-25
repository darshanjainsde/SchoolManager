import Link from 'next/link';
import '@/components/marketing/marketing.css';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

/**
 * The existing `.mkt` marketing nav, factored out so marketing.css is only
 * ever imported by the platform-blog branch — tenant blog pages (which never
 * render this component) must not ship marketing.css in their bundle.
 */
export default function PlatformBlogNav({ variant }: { variant: 'index' | 'post' }) {
  return (
    <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <Link href="/" className="logo"><SckoolsLogo size={32} /></Link>
          {variant === 'post' && <Link className="lnk" href="/blog">Blog</Link>}
          <a className="lnk" href="/pricing">Pricing</a>
          {variant === 'index' && <a className="lnk" href="/school-website-builder">Website builder</a>}
        </div>
      </nav>
    </div>
  );
}
