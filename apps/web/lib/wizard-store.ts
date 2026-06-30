'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CsvUser {
  email: string;
  firstName: string;
  lastName: string;
}

export interface WizardData {
  step: number;

  // Step 1 — basics
  name: string;
  slug: string;

  // Step 2 — branding
  logoUrl?: string;
  faviconUrl?: string;
  brandPrimary?: string;
  brandAccent?: string;
  aboutPage?: string;

  // Step 3 — contact + locale
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  geoLat?: number;
  geoLng?: number;
  phone?: string;
  email?: string;
  timezone?: string;
  currency?: string;

  // Step 4 — plan
  subscriptionPlan: 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';

  // Step 5 — domain (optional)
  domainHostname?: string;
  domainType?: 'APEX' | 'SUBDOMAIN';

  // Step 6 — CSV
  initialTeachers: CsvUser[];
  initialStudents: CsvUser[];

  // Step 7 — admin (we collect it on the basics step too)
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
}

const initial: WizardData = {
  step: 1,
  name: '',
  slug: '',
  subscriptionPlan: 'TRIAL',
  initialTeachers: [],
  initialStudents: [],
  adminEmail: '',
  adminFirstName: '',
  adminLastName: '',
};

interface WizardActions {
  patch: (p: Partial<WizardData>) => void;
  next: () => void;
  prev: () => void;
  goto: (step: number) => void;
  reset: () => void;
}

export const useWizardStore = create<WizardData & WizardActions>()(
  persist(
    (set) => ({
      ...initial,
      patch: (p) => set(p),
      next: () => set((s) => ({ step: Math.min(s.step + 1, 7) })),
      prev: () => set((s) => ({ step: Math.max(s.step - 1, 1) })),
      goto: (step) => set({ step }),
      reset: () => set(initial),
    }),
    { name: 'skoolos:wizard', version: 1 },
  ),
);
