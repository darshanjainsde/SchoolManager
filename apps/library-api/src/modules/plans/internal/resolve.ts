export const CAPABILITIES = [
  'CATALOG', 'CIRCULATION', 'MEMBERS', 'SEATS', 'ATTENDANCE', 'QR_REGISTRATION', 'BASIC_ANALYTICS',
  'FEES', 'EXPENSES', 'REVENUE_DASHBOARD', 'REPORTS_EXPORT', 'CUSTOM_REG_FORM',
  'WHATSAPP_RECEIPT', 'WHATSAPP_DUE_REMINDER',
  'MULTI_BRANCH', 'MULTI_ADMIN', 'WHATSAPP_EXPIRY_REMINDER', 'PRIORITY_SUPPORT',
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number];
export type PlanKey = 'FREE' | 'MINI' | 'PRO';
export interface Quotas { branches: number; adminSeats: number }

const FREE: CapabilityKey[] = [
  'CATALOG', 'CIRCULATION', 'MEMBERS', 'SEATS', 'ATTENDANCE', 'QR_REGISTRATION', 'BASIC_ANALYTICS',
];
const MINI: CapabilityKey[] = [
  ...FREE, 'FEES', 'EXPENSES', 'REVENUE_DASHBOARD', 'REPORTS_EXPORT', 'CUSTOM_REG_FORM',
  'WHATSAPP_RECEIPT', 'WHATSAPP_DUE_REMINDER',
];
const PRO: CapabilityKey[] = [
  ...MINI, 'MULTI_BRANCH', 'MULTI_ADMIN', 'WHATSAPP_EXPIRY_REMINDER', 'PRIORITY_SUPPORT',
];

const PLANS: Record<PlanKey, { caps: CapabilityKey[]; quotas: Quotas }> = {
  FREE: { caps: FREE, quotas: { branches: 1, adminSeats: 1 } },
  MINI: { caps: MINI, quotas: { branches: 1, adminSeats: 1 } },
  PRO: { caps: PRO, quotas: { branches: Infinity, adminSeats: Infinity } },
};

const isCapability = (key: string): key is CapabilityKey =>
  (CAPABILITIES as readonly string[]).includes(key);

/**
 * Returns capabilities AND quotas. Librify's tiers gate on counts (1 branch,
 * 1 admin), which a boolean-only Set cannot express — that is the whole reason
 * this differs from the Sckools feature resolver.
 */
export function resolvePlan(
  plan: PlanKey,
  overrides: { key: string; enabled: boolean }[],
): { capabilities: Set<CapabilityKey>; quotas: Quotas } {
  const base = PLANS[plan];
  const capabilities = new Set<CapabilityKey>(base.caps);
  for (const o of overrides) {
    if (!isCapability(o.key)) continue;
    if (o.enabled) capabilities.add(o.key);
    else capabilities.delete(o.key);
  }
  return { capabilities, quotas: { ...base.quotas } };
}
