import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import styles from './privacy.module.css';

const LAST_UPDATED = '26 July 2026';
const CONTACT_EMAIL = 'admin@sckools.com';

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
  title: 'Privacy Policy — Sckools',
  description:
    'How Sckools collects, uses and protects personal information across its school website platform and the Sckools mobile app for parents, students and staff.',
  alternates: { canonical: 'https://sckools.com/privacy' },
  metadataBase: new URL('https://sckools.com'),
  icons: ICONS,
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Privacy Policy — Sckools',
    description: 'How Sckools handles personal information across the platform and the Sckools mobile app.',
    url: 'https://sckools.com/privacy',
    siteName: 'Sckools',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools' }],
  },
  twitter: { card: 'summary_large_image', title: 'Privacy Policy — Sckools', images: ['/og.png'] },
};

export default async function PrivacyPage() {
  const host = await getRequestHost();
  // The policy belongs to the Sckools platform site, not to a tenant school host.
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
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

        <p className={styles.lede}>
          Sckools provides school websites and management tools, and the Sckools
          mobile app that lets parents, students and staff view attendance,
          notices and school holidays. This policy explains what personal
          information we handle, why, and the choices you have.
        </p>

        <div className={styles.note}>
          <strong>Your school is in charge of your data.</strong> When you use
          Sckools through your school, the school decides what information is
          entered and how it is used — the school is the <em>data controller</em>
          {' '}and Sckools acts as its <em>data processor</em>. For access,
          correction or deletion of a student&apos;s or child&apos;s data, contact
          your school first; we act on the school&apos;s instructions.
        </div>

        <nav className={styles.toc} aria-label="Contents">
          <p>Contents</p>
          <ol>
            <li><a href="#collect">Information we collect</a></li>
            <li><a href="#use">How we use it</a></li>
            <li><a href="#students">Students &amp; children</a></li>
            <li><a href="#share">How we share it</a></li>
            <li><a href="#retention">Data retention</a></li>
            <li><a href="#security">Security</a></li>
            <li><a href="#rights">Your rights</a></li>
            <li><a href="#providers">Service providers</a></li>
            <li><a href="#changes">Changes</a></li>
            <li><a href="#contact">Contact us</a></li>
          </ol>
        </nav>

        <section className={styles.section} id="collect">
          <h2>1. Information we collect</h2>
          <p>We collect only what is needed to run the service for your school:</p>

          <h3>Account &amp; sign-in</h3>
          <ul>
            <li>Your login identifier (an email address or username issued by your school) and password. Passwords are stored only as a salted hash — we never store them in readable form.</li>
            <li>Session tokens that keep you signed in.</li>
          </ul>

          <h3>School profile</h3>
          <ul>
            <li>Details your school records about you — for example name, class or section, admission number, roll number and a profile photo (where provided).</li>
          </ul>

          <h3>App activity created at school</h3>
          <ul>
            <li>Attendance records, notices and announcements, and the school holiday calendar that staff manage and that parents and students view.</li>
          </ul>

          <h3>Notifications &amp; device</h3>
          <ul>
            <li>If you enable push notifications, a push token for your device so we can deliver alerts (for example an attendance notice). We use basic device information for this purpose only.</li>
          </ul>

          <p>
            The Sckools app does <strong>not</strong> include third-party
            advertising, and we do <strong>not</strong> track you across other
            apps or websites.
          </p>
        </section>

        <section className={styles.section} id="use">
          <h2>2. How we use information</h2>
          <ul>
            <li>To authenticate you and keep your account secure.</li>
            <li>To provide the features you use — attendance, notices and holidays.</li>
            <li>To send notifications you have opted into.</li>
            <li>To operate, maintain, troubleshoot and improve the service.</li>
            <li>To meet legal obligations and enforce our terms.</li>
          </ul>
          <p>
            We do <strong>not</strong> sell personal information, and we do not
            use it for advertising or automated profiling.
          </p>
        </section>

        <section className={styles.section} id="students">
          <h2>3. Students and children</h2>
          <p>
            Sckools is provided to schools for educational use. Student accounts
            and student information are created and controlled by the school. The
            school is responsible for obtaining any consent required from parents
            or guardians under applicable law.
          </p>
          <p>
            We process student information solely to provide the service to the
            school and on the school&apos;s instructions. We do not use student
            information to build advertising profiles. Parents and guardians can
            exercise rights over a child&apos;s data through the school.
          </p>
        </section>

        <section className={styles.section} id="share">
          <h2>4. How we share information</h2>
          <p>We share information only in these limited ways:</p>
          <ul>
            <li><strong>With your school.</strong> Information is visible to the authorised staff and members of the school you belong to, according to their role.</li>
            <li><strong>With service providers</strong> that host and operate the platform on our behalf, under contract and only as needed (see <a href="#providers">Service providers</a>).</li>
            <li><strong>For legal reasons</strong> when required by law, or to protect the rights, safety and security of users and the service.</li>
            <li><strong>In a business transfer</strong> such as a merger or acquisition, subject to this policy.</li>
          </ul>
          <p>Data for one school is kept logically isolated from every other school on the platform.</p>
        </section>

        <section className={styles.section} id="retention">
          <h2>5. Data retention</h2>
          <p>
            We keep personal information for as long as your account is active
            and your school uses the service, and as needed to provide it. When a
            school ends its use of Sckools, or on the school&apos;s instruction,
            we delete or anonymise the associated data within a reasonable period,
            except where we must retain it to meet a legal obligation.
          </p>
        </section>

        <section className={styles.section} id="security">
          <h2>6. Security</h2>
          <ul>
            <li>Data is encrypted in transit (HTTPS/TLS).</li>
            <li>Passwords are stored only as salted hashes.</li>
            <li>Each school&apos;s data is isolated from other schools at the database level.</li>
            <li>Access is limited by role and protected by authentication.</li>
          </ul>
          <p>No method of transmission or storage is perfectly secure, but we work to protect your information using appropriate measures.</p>
        </section>

        <section className={styles.section} id="rights">
          <h2>7. Your rights and choices</h2>
          <ul>
            <li><strong>Access &amp; correction.</strong> You can view your profile in the app. To correct school-held details, contact your school.</li>
            <li><strong>Deletion.</strong> Requests to delete a student&apos;s or child&apos;s data are handled through the school as data controller; you may also contact us and we will act on the school&apos;s instructions.</li>
            <li><strong>Notifications.</strong> You can turn push notifications off at any time in your device settings.</li>
          </ul>
          <p>Depending on where you live, you may have additional rights under local law. Contact us and we will help route your request appropriately.</p>
        </section>

        <section className={styles.section} id="providers">
          <h2>8. Service providers</h2>
          <p>We rely on a small number of trusted providers to run Sckools:</p>
          <ul>
            <li><strong>Hosting &amp; database</strong> — cloud infrastructure that stores and serves platform data.</li>
            <li><strong>Push notification delivery</strong> — the Expo push service, used to deliver app notifications to your device.</li>
          </ul>
          <p>These providers may process information only to perform services for us, under obligations consistent with this policy.</p>
        </section>

        <section className={styles.section} id="changes">
          <h2>9. Changes to this policy</h2>
          <p>
            We may update this policy from time to time. When we make material
            changes, we will update the date at the top of this page and, where
            appropriate, notify you through the service.
          </p>
        </section>

        <section className={styles.section} id="contact">
          <h2>10. Contact us</h2>
          <p>
            Questions about this policy or your information? Email us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If your
            question is about a specific student or school record, please also
            contact your school.
          </p>
        </section>
      </main>

      <footer className={styles.foot}>
        © {new Date().getFullYear().toString()} Sckools · <Link href="/" style={{ color: 'inherit', fontWeight: 600 }}>sckools.com</Link>
      </footer>
    </div>
  );
}
