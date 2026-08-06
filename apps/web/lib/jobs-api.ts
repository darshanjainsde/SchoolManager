/**
 * The network jobs board. It lives on sckools.com ONLY — see
 * docs/superpowers/specs/2026-08-05-hiring-design.md — so every fetch here goes
 * to the platform, with no tenant host header.
 */
export interface PublicJob {
  id: string;
  title: string;
  summary: string;
  description?: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY';
  subject: string | null;
  /** How many people the school needs. Never a boolean. */
  posts: number;
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  currency: string;
  applyBy: string | null;
  school: { name: string; slug: string };
  questions?: PublicJobQuestion[];
}

export interface PublicJobQuestion {
  id: string;
  prompt: string;
  kind: 'CHOICE' | 'YES_NO' | 'NUMBER' | 'TEXT';
  options: string[];
  required: boolean;
}

function base(): string {
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  return raw.replace('localhost', '127.0.0.1');
}

export async function fetchJobs(filters: Record<string, string | undefined> = {}): Promise<PublicJob[]> {
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => !!v) as [string, string][],
  ).toString();
  try {
    const res = await fetch(`${base()}/public/jobs${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as PublicJob[];
  } catch {
    return [];
  }
}

export async function fetchJob(id: string): Promise<PublicJob | null> {
  try {
    const res = await fetch(`${base()}/public/jobs/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PublicJob;
  } catch {
    return null;
  }
}

/** Minor units → a salary a person reads. */
export function formatPay(job: PublicJob): string | null {
  const sym: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€' };
  const s = sym[job.currency] ?? `${job.currency} `;
  const fmt = (m: number) => `${s}${Math.round(m / 100).toLocaleString('en-IN')}`;
  if (job.salaryMinMinor && job.salaryMaxMinor) return `${fmt(job.salaryMinMinor)} – ${fmt(job.salaryMaxMinor)}`;
  if (job.salaryMinMinor) return `From ${fmt(job.salaryMinMinor)}`;
  if (job.salaryMaxMinor) return `Up to ${fmt(job.salaryMaxMinor)}`;
  return null;
}

export const EMPLOYMENT_LABEL: Record<PublicJob['employmentType'], string> = {
  FULL_TIME: 'Full time',
  PART_TIME: 'Part time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
};
