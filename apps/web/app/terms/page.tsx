import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import styles from '../privacy/privacy.module.css';

/**
 * Launch-gate #8: privacy basics for 600 minors — the terms half. A school
 * signing up (and a parent checking who runs their child's school site)
 * expects a terms URL beside the privacy policy. Same visual shell as
 * /privacy, same platform-host-only rule.
 */

const LAST_UPDATED = '22 August 2026';
const CONTACT_EMAIL = 'admin@sckools.com';

export const metadata: Metadata = {
  title: 'Terms of Service — Sckools',
  description:
    'The terms under which schools, staff, students and parents use the Sckools school-website platform and the Sckools mobile app.',
  alternates: { canonical: 'https://sckools.com/terms' },
  metadataBase: new URL('https://sckools.com'),
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Terms of Service — Sckools',
    description: 'The terms under which schools and their communities use Sckools.',
    url: 'https://sckools.com/terms',
    siteName: 'Sckools',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools' }],
  },
};

export default async function TermsPage() {
  const host = await getRequestHost();
  if (!isPlatformHost(host)) notFound();

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link className={styles.brand} href="/" aria-label="Sckools home">
            <SckoolsLogo size={26} />
            <span>Sckools</span>
          </Link>
          <Link className={styles.home} href="/">← Back to home</Link>
        </div>
      </header>

      <main className={styles.wrap}>
        <p className={styles.eyebrow}>Legal</p>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

        <p className={styles.lede}>
          These terms govern the use of Sckools — the school-website platform, the school, teacher,
          student and parent consoles, and the Sckools mobile app. By creating an account or using a
          school&apos;s Sckools-powered site or portal, you agree to them.
        </p>

        <div className={styles.note}>
          <strong>Schools come first in this relationship.</strong> Sckools contracts with schools.
          Your school decides what appears on its website, which features are enabled, and what data
          is entered about its students and staff — Sckools operates the platform on the school&apos;s
          instructions. See the <Link href="/privacy">Privacy Policy</Link> for how personal
          information is handled.
        </div>

        <h2 id="service">1. The service</h2>
        <p>
          Sckools provides each subscribing school a public website (on a Sckools subdomain or the
          school&apos;s own domain), administrative consoles for school content and operations
          (attendance, notices, diaries, exams, events, admissions enquiries, the school blog), and
          portals and a mobile app through which staff, students and parents use those features. The
          exact feature set depends on the school&apos;s plan.
        </p>

        <h2 id="accounts">2. Accounts</h2>
        <p>
          School staff, student and parent accounts are created by, or at the direction of, the
          school. You must keep your credentials confidential and tell your school at once if you
          believe your account has been misused. Accounts belong to the school&apos;s tenancy; the
          school may suspend or remove them. Sckools may suspend accounts that threaten the security
          or integrity of the platform.
        </p>

        <h2 id="acceptable">3. Acceptable use</h2>
        <p>
          You agree not to misuse the platform: no attempts to access another school&apos;s or
          another user&apos;s data, no probing or disrupting the service, no uploading unlawful,
          infringing or harmful content, and no use of the platform to harass any person. Schools are
          responsible for the content they publish on their sites, including having the right to use
          the photographs and text they upload.
        </p>

        <h2 id="content">4. School content and student data</h2>
        <p>
          Content a school publishes (site text, images, posts, notices) remains the school&apos;s.
          The school grants Sckools the licence needed to host and display it as directed. Student
          and family personal data is processed on the school&apos;s behalf as described in the{' '}
          <Link href="/privacy">Privacy Policy</Link>; under India&apos;s DPDP Act the school, as the
          data fiduciary for its community, is responsible for the lawful basis (including parental
          consent where required) of the data it enters.
        </p>

        <h2 id="availability">5. Availability and changes</h2>
        <p>
          We work to keep the platform available and fast, but it is provided &quot;as is&quot; and
          uninterrupted operation cannot be guaranteed — maintenance windows, provider incidents and
          factors outside our control can cause downtime. We may improve or change features over
          time; where a change materially reduces a paid capability, affected schools will be
          notified in advance.
        </p>

        <h2 id="fees">6. Fees</h2>
        <p>
          Pilot use is free unless agreed otherwise in writing with the school. Paid plans, pricing
          and billing terms are set out in the school&apos;s order or subscription agreement, which
          prevails over this section if they differ.
        </p>

        <h2 id="termination">7. Termination, export and deletion</h2>
        <p>
          A school may end its subscription at any time. On termination the school&apos;s public
          site is taken offline and, after a wind-down period allowing data export, the
          school&apos;s tenancy data is deleted from live systems, with backups expiring on their
          rotation schedule. Individual account holders can request account deletion as described at{' '}
          <Link href="/delete-account">sckools.com/delete-account</Link>; requests concerning a
          student&apos;s record go through the school.
        </p>

        <h2 id="liability">8. Liability</h2>
        <p>
          To the maximum extent permitted by law, Sckools is not liable for indirect or
          consequential loss, and its total liability arising out of the service in any twelve-month
          period is limited to the fees the school paid for the service in that period (or ₹10,000
          for free pilots). Nothing in these terms limits liability that cannot lawfully be limited.
        </p>

        <h2 id="changes">9. Changes to these terms</h2>
        <p>
          We may update these terms as the platform evolves; the date above always reflects the
          current version. Material changes will be announced to schools before they take effect.
          Continued use after a change takes effect means acceptance of the updated terms.
        </p>

        <h2 id="contact">10. Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. These
          terms are governed by the laws of India.
        </p>
      </main>
    </div>
  );
}
