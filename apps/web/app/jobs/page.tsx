import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { EMPLOYMENT_LABEL, fetchJobs, formatPay } from '@/lib/jobs-api';

export const metadata: Metadata = {
  title: 'Teaching jobs across the Sckools network',
  description: 'Open roles at schools using Sckools — teaching, support and leadership.',
};

/**
 * The network jobs board.
 *
 * sckools.com ONLY. A school's own site never carries hiring, which is what
 * makes owner approval load-bearing: every post lands on the owner's own front
 * door. A tenant host reaching this route gets a 404 rather than an empty board.
 */
export default async function JobsBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; subject?: string; school?: string }>;
}) {
  const host = await getRequestHost();
  if (!isPlatformHost(host)) notFound();

  const filters = await searchParams;
  const jobs = await fetchJobs({
    employmentType: filters.type,
    subject: filters.subject,
    school: filters.school,
  });

  return (
    <div className="mkt">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <header>
          <span className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Jobs</span>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">
            Teaching jobs across the network
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Open roles at schools running on Sckools. Applying takes a minute and needs no account.
          </p>
        </header>

        {jobs.length === 0 ? (
          <div className="mt-12 rounded-3xl border border-slate-200 bg-white p-12 text-center">
            <svg viewBox="0 0 120 84" className="mx-auto h-24 w-32" fill="none" aria-hidden="true">
              <rect x="16" y="24" width="88" height="52" rx="10" stroke="#6366f1" strokeWidth="2.5" opacity=".35" />
              <path d="M44 24v-6a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v6" stroke="#6366f1" strokeWidth="2.5" opacity=".5" />
              <path d="M16 44h88" stroke="#6366f1" strokeWidth="2.5" opacity=".25" />
              <circle cx="60" cy="44" r="5" fill="#f59e0b" opacity=".5" />
            </svg>
            <h2 className="mt-5 text-lg font-bold text-slate-900">No open roles right now</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              Schools post vacancies here as they open. Worth checking back — or ask your school to list with us.
            </p>
          </div>
        ) : (
          <ul className="mt-10 space-y-4">
            {jobs.map((job) => {
              const pay = formatPay(job);
              return (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="block rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-indigo-300 hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="text-lg font-bold text-slate-900">{job.title}</h2>
                      <span className="text-sm text-slate-500">{job.school.name}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{job.summary}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700">
                        {EMPLOYMENT_LABEL[job.employmentType]}
                      </span>
                      {job.subject && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                          {job.subject}
                        </span>
                      )}
                      {/* An Int, not a boolean: "we need three" is the most
                          useful fact on a listing. */}
                      {job.posts > 1 && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
                          {job.posts} positions
                        </span>
                      )}
                      {pay && <span className="font-semibold text-slate-700">{pay}</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
