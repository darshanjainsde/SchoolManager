import Link from 'next/link';
import '@/components/marketing/marketing.css';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

/**
 * The existing `.mkt` marketing nav, factored out so marketing.css is only
 * ever imported by the pages that need it — tenant blog pages (which never
 * render this component) must not ship marketing.css in their bundle.
 *
 * Also worn by the jobs board and a vacancy page: both live on sckools.com and
 * must not be dead ends, which they were when they shipped with no nav at all.
 */
export default function PlatformBlogNav({ variant }: { variant: 'index' | 'post' | 'jobs' | 'job' }) {
  return (
    <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <Link href="/" className="logo"><SckoolsLogo size={32} /></Link>
          {variant === 'post' && <Link className="lnk" href="/blog">Blog</Link>}
          {variant === 'job' && <Link className="lnk" href="/jobs">Jobs</Link>}
          <a className="lnk" href="/pricing">Pricing</a>
          {variant !== 'jobs' && <Link className="lnk" href="/jobs">Jobs</Link>}
          {variant === 'index' && <a className="lnk" href="/school-website-builder">Website builder</a>}
        </div>
      </nav>
    </div>
  );
}
