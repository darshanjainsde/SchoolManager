import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import styles from '../privacy/privacy.module.css';

/**
 * How the Sckools team works (hybrid). Linked from the LinkedIn company page's
 * "workplace policy" field. Same shell and platform-host-only rule as /privacy
 * and /terms; plain words, no promises the team has not made.
 */

const LAST_UPDATED = '20 October 2026';
const CONTACT_EMAIL = 'admin@sckools.com';

export const metadata: Metadata = {
  title: 'How we work — Sckools',
  description:
    'Sckools is a hybrid team: focused work from home, and time together in person to plan, build and help the schools we serve.',
  alternates: { canonical: 'https://sckools.com/workplace' },
  metadataBase: new URL('https://sckools.com'),
  robots: { index: true, follow: true },
  openGraph: {
    title: 'How we work — Sckools',
    description: 'Sckools is a hybrid team. Here is what that means day to day.',
    url: 'https://sckools.com/workplace',
    siteName: 'Sckools',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools' }],
  },
};

export default async function WorkplacePage() {
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
        <p className={styles.eyebrow}>Our team</p>
        <h1 className={styles.title}>How we work</h1>
        <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

        <p className={styles.lede}>
          Sckools builds one app for the whole school: parents, teachers and the school office. We
          are a hybrid team. We do focused work from home and come together in person when working
          side by side helps.
        </p>

        <div className={styles.note}>
          <strong>In short:</strong> work from home for focused work, meet in person to plan, build
          together and help schools. We judge work by what it does for schools, not by hours at a
          desk.
        </div>

        <h2 id="hybrid">1. What hybrid means here</h2>
        <p>
          Most days, each person chooses where they do their best work. We meet in person for
          planning, for big launches, and whenever a problem is easier to solve in one room. The
          team agrees these days ahead of time, so everyone can plan around them.
        </p>

        <h2 id="schools">2. Schools come first</h2>
        <p>
          Our work is used by teachers, parents and school offices every day. When a school needs
          help to set up, learn the app or fix a problem, we make time for it, on a call or in
          person.
        </p>

        <h2 id="together">3. Working well together</h2>
        <p>
          We write things down so nobody has to be in the room to know what was decided. We keep
          shared hours for calls and reply within the working day. Everyone gets the tools they need
          to work well from home.
        </p>

        <h2 id="trust">4. Trust and flexibility</h2>
        <p>
          We trust people to manage their own time. Life happens: family, travel, festivals and
          exams. Tell the team early, and we will work around it together.
        </p>

        <h2 id="contact">5. Questions</h2>
        <p>
          Want to work with us, or have a question about how we work? Write to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </main>
    </div>
  );
}
