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
};

export const useWizardStore = create<WizardData & WizardActions>()((setState) => ({
  ...initial,
  set: (partial) => setState(partial),
  reset: () => setState(initial),
}));
