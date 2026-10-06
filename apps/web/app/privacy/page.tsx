import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import styles from './privacy.module.css';

const LAST_UPDATED = '7 October 2026';
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
          Sckools gives schools a website and tools to run the school, and the
          Sckools mobile app for parents, students, teachers and school staff.
          This policy explains what personal information we handle, why, who
          helps us run the service, and the choices you have.
        </p>

        <div className={styles.note}>
          <strong>Your school is in charge of your data.</strong> When you use
          Sckools through your school, the school decides what information is
          entered and how it is used. The school is the <em>data controller</em>
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
            <li><a href="#rights">Your rights and choices</a></li>
            <li><a href="#providers">Service providers</a></li>
            <li><a href="#changes">Changes</a></li>
            <li><a href="#contact">Contact us</a></li>
          </ol>
        </nav>

        <section className={styles.section} id="collect">
          <h2>1. Information we collect</h2>
          <p>We collect only what is needed to run the service for your school.</p>

          <h3>Account and sign-in</h3>
          <ul>
            <li>Your login: an email address, or a student code issued by your school, and your password. Passwords are stored only as a salted hash; we never store them in readable form.</li>
            <li>Your mobile number, if you or your school add one. It is used to send you a sign-in code when your school turns that on, and to send school messages.</li>
            <li>Session tokens that keep you signed in.</li>
          </ul>

          <h3>School records</h3>
          <ul>
            <li>Details your school records about a student or staff member, for example name, class and section, admission and roll number, date of birth, a profile photo, and a parent&apos;s contact number.</li>
            <li>Records the school keeps as part of school life: attendance, timetable, homework, tests and results, report cards, the class diary, notices, the holiday calendar, library loans, sports houses and results, and leave.</li>
          </ul>

          <h3>Things you send in the app</h3>
          <ul>
            <li>Messages between parents and teachers, complaint-box entries and replies, diary sign-offs, and leave applications.</li>
            <li>Photos and files you choose to upload, such as a profile photo or a homework attachment.</li>
          </ul>

          <h3>Fees and payments</h3>
          <ul>
            <li>The fees your school charges and the receipts it issues.</li>
            <li>When you tell the school you have paid: the amount, the date, how you paid, the UPI or bank reference, and a screenshot if you add one.</li>
            <li>The app can open your own UPI app (such as Google Pay or PhonePe) with the amount filled in. The payment happens in that app, between you and the school; we never see your UPI PIN or bank login.</li>
            <li>If your school turns on online payment, the payment is handled by the payment company (Razorpay or PhonePe). Card and bank details go to them, not to us.</li>
          </ul>

          <h3>Pay details for school staff</h3>
          <ul>
            <li>If your school runs staff pay on Sckools, staff can enter their bank account number, IFSC, bank name, PAN and UAN. Only the school&apos;s administrators and pay office can see them, and they are used only to pay you and to file statutory returns.</li>
          </ul>

          <h3>Notifications and your device</h3>
          <ul>
            <li>If you allow notifications, a push token for your device so we can deliver school alerts.</li>
            <li>If the app crashes or hits an error, a crash report: the device model, Android version, app version and the technical error. Crash reports do not include your messages or school records.</li>
          </ul>

          <p>
            The Sckools app does <strong>not</strong> show ads, does not use an
            advertising ID, does not collect your location or contacts, and does
            not track you across other apps or websites.
          </p>
        </section>

        <section className={styles.section} id="use">
          <h2>2. How we use information</h2>
          <ul>
            <li>To sign you in and keep your account secure.</li>
            <li>To provide the features your school uses: attendance, diary, homework, results, notices, holidays, fees, messages, library, sports, leave and pay.</li>
            <li>To send the notifications and school messages you receive, by push notification, email, or WhatsApp where your school uses it.</li>
            <li>To find and fix crashes and errors, and to keep the service running.</li>
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
            Sckools is provided to schools for educational use, and students of
            all school ages may use the app with a login their school gives them.
            Student accounts and student information are created and controlled
            by the school. The school is responsible for getting any consent
            required from parents or guardians under applicable law.
          </p>
          <p>
            We process student information only to provide the service to the
            school and on the school&apos;s instructions. The app has no ads, no
            advertising or analytics tracking, and no way for a student to
            contact anyone outside their own school. We never use children&apos;s
            information for advertising or to build profiles.
          </p>
          <p>
            Parents and guardians can see, correct or delete a child&apos;s data
            through the school, or by writing to us (see <a href="#rights">Your rights</a>).
          </p>
        </section>

        <section className={styles.section} id="share">
          <h2>4. How we share information</h2>
          <p>We share information only in these limited ways:</p>
          <ul>
            <li><strong>Within your school.</strong> Information is visible to the people at your school who need it for their role. For example, a class teacher sees their class, and the administrators and pay office see staff pay details.</li>
            <li><strong>With service providers</strong> that run parts of the service for us, under contract and only as needed (see <a href="#providers">Service providers</a>).</li>
            <li><strong>For legal reasons</strong> when required by law, or to protect the rights, safety and security of users and the service.</li>
            <li><strong>In a business transfer</strong> such as a merger or acquisition, subject to this policy.</li>
          </ul>
          <p>Each school&apos;s data is kept separate from every other school on the platform.</p>
        </section>

        <section className={styles.section} id="retention">
          <h2>5. Data retention</h2>
          <p>
            We keep personal information while your account is active and your
            school uses the service. When a school stops using Sckools, or on the
            school&apos;s instruction, we delete or anonymise the associated data
            within a reasonable period, except where we must keep it to meet a
            legal obligation, such as fee and pay records. Crash reports are kept
            for up to 90 days.
          </p>
        </section>

        <section className={styles.section} id="security">
          <h2>6. Security</h2>
          <ul>
            <li>Data is encrypted in transit (HTTPS/TLS) and encrypted at rest by our database provider.</li>
            <li>Passwords are stored only as salted hashes.</li>
            <li>Each school&apos;s data is isolated from other schools at the database level.</li>
            <li>Access is limited by role and protected by sign-in.</li>
          </ul>
          <p>No method of transmission or storage is perfectly secure, but we work to protect your information using appropriate measures.</p>
        </section>

        <section className={styles.section} id="rights">
          <h2>7. Your rights and choices</h2>
          <ul>
            <li><strong>Access and correction.</strong> You can see your profile in the app. To correct details the school holds, contact your school.</li>
            <li><strong>Deletion.</strong> You can ask to delete your account and its data at <Link href="/delete-account">sckools.com/delete-account</Link>. Because your school owns the account, we confirm the request with the school first.</li>
            <li><strong>Notifications.</strong> You can turn push notifications off at any time in your phone&apos;s settings. To stop school messages on WhatsApp, ask your school or write to us.</li>
            <li><strong>Optional details.</strong> A profile photo, a mobile number and uploads are optional; you can leave them out.</li>
          </ul>
          <p>Depending on where you live, you may have more rights under local law, including India&apos;s Digital Personal Data Protection Act. Contact us and we will help route your request.</p>
        </section>

        <section className={styles.section} id="providers">
          <h2>8. Service providers</h2>
          <p>We use a small number of providers to run Sckools. They may use information only to provide their service to us.</p>
          <ul>
            <li><strong>Vercel</strong> runs our website and servers.</li>
            <li><strong>Supabase</strong> stores our database and uploaded files, in Mumbai, India.</li>
            <li><strong>Expo</strong> and <strong>Google Firebase Cloud Messaging</strong> deliver push notifications to your phone.</li>
            <li><strong>Meta (WhatsApp Business Platform)</strong> delivers school messages on WhatsApp, where your school uses it.</li>
            <li><strong>Our email provider</strong>, or your school&apos;s own mail server, sends email.</li>
            <li><strong>Sentry</strong> receives crash reports from the app, stored in the European Union.</li>
            <li><strong>Razorpay</strong> or <strong>PhonePe</strong> process online fee payments, only if your school turns that on.</li>
          </ul>
        </section>

        <section className={styles.section} id="changes">
          <h2>9. Changes to this policy</h2>
          <p>
            We may update this policy from time to time. When we make material
            changes, we will update the date at the top of this page and, where
            appropriate, tell you through the service.
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
