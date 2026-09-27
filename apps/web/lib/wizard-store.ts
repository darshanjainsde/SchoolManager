'use client';
import { create } from 'zustand';

export type Tier = 'BASIC' | 'STANDARD' | 'PRO';

export interface WizardData {
  step: number;
  name: string;
  slug: string;
  domainHostname: string;
  adminEmail: string;
  tier: Tier;
  /** ISO 3166-1 alpha-2 — the country switch. Chosen at creation, India by default. */
  countryCode: string;
}

export interface WizardActions {
  set: (partial: Partial<WizardData>) => void;
  reset: () => void;
}

const initial: WizardData = {
  step: 1,
  name: '',
  slug: '',
  domainHostname: '',
  adminEmail: '',
  tier: 'STANDARD',
  countryCode: 'IN',
};

export const useWizardStore = create<WizardData & WizardActions>()((setState) => ({
  ...initial,
  set: (partial) => setState(partial),
  reset: () => setState(initial),
}));
