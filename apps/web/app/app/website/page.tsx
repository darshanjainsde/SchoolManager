'use client';
import { useState } from 'react';
import { useSiteForm } from './site-form';
import BrandingTab from './branding-tab';
import ThemeTab from './theme-tab';
import HomepageTab from './homepage-tab';
import AboutTab from './about-tab';
import ContactTab from './contact-tab';
import GalleryTab from './gallery-tab';
import StaffTab from './staff-tab';
import CoursesTab from './courses-tab';
import AdmissionsTab from './admissions-tab';
import HallOfFameTab from './hof-tab';
import DesignTab from './design-tab';
import MenuTab from './menu-tab';

/**
 * Website console shell: the tab bar, plus the one shared settings form the
 * first five tabs edit (see site-form.ts). Every tab body lives in its own
 * file — Gallery, Staff, Courses, Admissions, Hall of Fame and Design own
 * their own data and mount only while their tab is open.
 */

type Tab =
  | 'branding'
  | 'theme'
  | 'design'
  | 'menu'
  | 'homepage'
  | 'about'
  | 'contact'
  | 'courses'
  | 'admissions'
  | 'hof'
  | 'gallery'
  | 'staff';

const TABS: { id: Tab; label: string }[] = [
  { id: 'branding', label: 'Branding' },
  { id: 'theme', label: 'Theme' },
  { id: 'design', label: 'Design' },
  { id: 'menu', label: 'Menu' },
  { id: 'homepage', label: 'Homepage' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact & address' },
  { id: 'courses', label: 'Courses' },
  { id: 'admissions', label: 'Admissions' },
  { id: 'hof', label: 'Hall of Fame' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'staff', label: 'Staff' },
];

export default function WebsitePage() {
  const [activeTab, setActiveTab] = useState<Tab>('branding');
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
      {activeTab === 'branding' && <BrandingTab form={form} />}
      {activeTab === 'theme' && <ThemeTab form={form} onGoToDesign={() => setActiveTab('design')} />}
      {activeTab === 'homepage' && <HomepageTab form={form} onGoToDesign={() => setActiveTab('design')} />}
      {activeTab === 'about' && <AboutTab form={form} />}
      {activeTab === 'contact' && <ContactTab form={form} />}
      {activeTab === 'design' && <DesignTab />}
      {activeTab === 'menu' && <MenuTab />}
      {activeTab === 'courses' && <CoursesTab />}
      {activeTab === 'admissions' && <AdmissionsTab />}
      {activeTab === 'hof' && <HallOfFameTab />}
      {activeTab === 'gallery' && <GalleryTab />}
      {activeTab === 'staff' && <StaffTab />}
      </div>
    </div>
  );
}
