'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useSiteForm } from './site-form';
/**
 * Eleven tabs, loaded one at a time.
 *
 * They were static imports, so opening the Website console downloaded all
 * eleven — 40.5 kB of route chunk and 187 kB of first-load JavaScript, the
 * heaviest page in the product — to show the one tab that opens by default.
 * Only one is ever mounted (the switch below unmounts the rest), so only one
 * ever needed to be fetched.
 *
 * `ssr: false` because nothing here renders without a session anyway: the
 * console layout shows its skeleton until the API says who you are, so there
 * is no server render of a tab body to preserve.
 *
 * dynamic() is called once per tab, with its options written out in full each
 * time. Two separate reasons, and both bite: a generic helper widens the
 * loader's type and erases each tab's props (several take callbacks), and
 * Next's compiler rejects a shared options object outright — it reads them at
 * build time and requires an object literal.
 */
const loading = () => <div className="sk-tabskel" aria-busy="true" />;

const StudioTab = dynamic(() => import('./studio-tab'), { ssr: false, loading });
const HomepageTab = dynamic(() => import('./homepage-tab'), { ssr: false, loading });
const AboutTab = dynamic(() => import('./about-tab'), { ssr: false, loading });
const ContactTab = dynamic(() => import('./contact-tab'), { ssr: false, loading });
const GalleryTab = dynamic(() => import('./gallery-tab'), { ssr: false, loading });
const StaffTab = dynamic(() => import('./staff-tab'), { ssr: false, loading });
const CoursesTab = dynamic(() => import('./courses-tab'), { ssr: false, loading });
const AdmissionsTab = dynamic(() => import('./admissions-tab'), { ssr: false, loading });
const HallOfFameTab = dynamic(() => import('./hof-tab'), { ssr: false, loading });
const CelebrationsTab = dynamic(() => import('./celebrations-tab'), { ssr: false, loading });
const RecordsTab = dynamic(() => import('./records-tab'), { ssr: false, loading });

/**
 * Website console shell: the tab bar, plus the one shared settings form the
 * first five tabs edit (see site-form.ts). Every tab body lives in its own
 * file — Gallery, Staff, Courses, Admissions, Hall of Fame and Design own
 * their own data and mount only while their tab is open.
 */

type Tab =
  | 'studio'
  | 'homepage'
  | 'about'
  | 'contact'
  | 'courses'
  | 'admissions'
  | 'hof'
  | 'celebrations'
  | 'records'
  | 'gallery'
  | 'staff';

// Studio is DESIGN (colours, theme, first screen, sections, navbar + menu,
// scroll feel, festive, footer, custom pages & code) — all against a live
// preview, in one place. The remaining tabs are CONTENT: the words, people
// and photos that fill those sections. Branding/Theme/Design/Menu used to be
// four separate design tabs; they now live inside Studio.
const TABS: { id: Tab; label: string }[] = [
  { id: 'studio', label: 'Studio' },
  { id: 'homepage', label: 'Homepage' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact & address' },
  { id: 'courses', label: 'Courses' },
  { id: 'admissions', label: 'Admissions' },
  { id: 'hof', label: 'Hall of Fame' },
  { id: 'celebrations', label: 'Celebrations' },
  { id: 'records', label: 'Records' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'staff', label: 'Staff' },
];

export default function WebsitePage() {
  const [activeTab, setActiveTab] = useState<Tab>('studio');
  const form = useSiteForm();

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      {/* `sk-pagehead` supplies the portal's serif heading — see /app/events. */}
      <header className="sk-pagehead" style={{ marginBottom: 0 }}>
        <h1>Website content</h1>
        <p>Edit what visitors see on your public site.</p>
      </header>

      {form.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {form.error && (
        <p className="text-sm text-rose-600">{(form.error as Error).message}</p>
      )}

      {/* Tab bar */}
      <div className="flex border-b overflow-x-auto text-sm">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'sk-press px-4 py-2 border-b-2 whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'border-teal-600 text-teal-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* THE TAB BODY, WRAPPED AND KEYED ON THE TAB.
          Eleven tabs of a website editor are eleven near-identical stacks of
          labelled fields; switching between two of them can look like nothing
          happened. `sk-wfade` marks the replacement — the pitch's one gesture
          for "this view changed". The bodies already mount per tab, so the key
          changes no lifecycle. Reduced motion simply shows the new tab. */}
      <div className="sk-wfade" key={activeTab}>
      {activeTab === 'studio' && <StudioTab />}
      {activeTab === 'homepage' && <HomepageTab form={form} onGoToDesign={() => setActiveTab('studio')} onGoToCelebrations={() => setActiveTab('celebrations')} />}
      {activeTab === 'about' && <AboutTab form={form} />}
      {activeTab === 'contact' && <ContactTab form={form} />}
      {activeTab === 'courses' && <CoursesTab />}
      {activeTab === 'admissions' && <AdmissionsTab />}
      {activeTab === 'hof' && <HallOfFameTab />}
      {activeTab === 'celebrations' && <CelebrationsTab onGoToHomepage={() => setActiveTab('homepage')} />}
      {activeTab === 'records' && <RecordsTab onGoToStudio={() => setActiveTab('studio')} />}
      {activeTab === 'gallery' && <GalleryTab />}
      {activeTab === 'staff' && <StaffTab />}
      </div>
    </div>
  );
}
