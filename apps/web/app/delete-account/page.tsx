import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import styles from './delete-account.module.css';

const LAST_UPDATED = '26 July 2026';
const CONTACT_EMAIL = 'admin@sckools.com';

// Pre-filled request so a user's email gives us everything we need to act.
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  'Account deletion request',
)}&body=${encodeURIComponent(
  [
    'I would like to request deletion of my Sckools account and associated data.',
    '',
    'School code (e.g. raffles): ',
    'Full name: ',
    'Login (email or admission number): ',
    'Role (parent / student / teacher / staff): ',
  ].join('\n'),
)}`;

const ICONS = {
  icon: [
    { url: '/favicon.ico', sizes: '48x48' },
    { url: '/icon-48.png', type: 'image/png', sizes: '48x48' },
    { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    { url: '/sckools-icon.svg', type: 'image/svg+xml' },
  ],
  apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
};

export const metadata: Metadata = {
  title: 'Delete your account — Sckools',
  description:
    'How to request deletion of your Sckools account and associated data, what is removed, and what may be retained.',
  alternates: { canonical: 'https://sckools.com/delete-account' },
  metadataBase: new URL('https://sckools.com'),
  icons: ICONS,
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Delete your account — Sckools',
    description: 'Request deletion of your Sckools account and associated data.',
    url: 'https://sckools.com/delete-account',
    siteName: 'Sckools',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools' }],
  },
  twitter: { card: 'summary_large_image', title: 'Delete your account — Sckools', images: ['/og.png'] },
};

export default async function DeleteAccountPage() {
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
          <Link className={styles.home} href="/privacy">Privacy Policy</Link>
        </div>
      </header>

      <main className={styles.wrap}>
        <p className={styles.eyebrow}>Account</p>
        <h1 className={styles.title}>Delete your account</h1>
        <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

        <p className={styles.lede}>
          You can ask us to delete your Sckools account and the personal data
          associated with it. Sckools accounts are created and managed by your
          school, so we handle deletion together with your school.
        </p>

        <div className={styles.cta}>
          <h2>Request deletion by email</h2>
          <p>
            Email us and we&apos;ll verify the request with your school and
            process it. The pre-filled message asks for the few details we need
            to find the right account.
          </p>
          <a className={styles.btn} href={MAILTO}>Email {CONTACT_EMAIL}</a>
        </div>

        <section className={styles.section}>
          <h2>How it works</h2>
          <ul>
            <li>Send your request to <a href={MAILTO}>{CONTACT_EMAIL}</a> with your school code, name and login.</li>
            <li>Because your school is the owner of the account, we confirm the request with the school before deleting.</li>
            <li>You can also ask your school directly — a school administrator can remove an account from the school admin console.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>What we delete</h2>
          <p>On a confirmed request we delete the personal data tied to your account, including:</p>
          <ul>
            <li>Your account and login credentials.</li>
            <li>Your profile details (name, class, admission and roll number, profile photo).</li>
            <li>Your device push-notification tokens.</li>
            <li>Personal records linked to your account, such as your attendance history.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>What may be retained</h2>
          <p>
            A school may be legally required to keep certain academic or
            administrative records for a period of time; where that applies, the
            school (as the data controller) retains them under its own
            obligations. We may also keep limited information where the law
            requires it, and anonymised or aggregate data that no longer
            identifies you. Residual copies in encrypted backups are purged on
            our regular backup cycle.
          </p>
        </section>

        <section className={styles.section}>
          <h2>How long it takes</h2>
          <p>
            We aim to action verified deletion requests within <strong>30 days</strong>.
            If anything will take longer, we&apos;ll let you know.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Questions</h2>
          <p>
            See our <Link href="/privacy">Privacy Policy</Link> for how we handle
            data, or contact <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>
      </main>

      <footer className={styles.foot}>
        © {new Date().getFullYear().toString()} Sckools · <Link href="/" style={{ color: 'inherit', fontWeight: 600 }}>sckools.com</Link>
      </footer>
    </div>
  );
}
