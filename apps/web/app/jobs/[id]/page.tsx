import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { EMPLOYMENT_LABEL, fetchJob, formatPay } from '@/lib/jobs-api';
import ApplyForm from '@/components/marketing/ApplyForm';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const job = await fetchJob(id);
  if (!job) return { title: 'Job not found' };
  return {
    title: `${job.title} — ${job.school.name}`,
    description: job.summary,
  };
}

/** sckools.com only — a school's own site never carries hiring. */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const host = await getRequestHost();
  if (!isPlatformHost(host)) notFound();

  const { id } = await params;
  const job = await fetchJob(id);
  if (!job) notFound();

  const pay = formatPay(job);

  return (
    <div className="mkt">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/jobs" className="text-sm font-semibold text-indigo-600">
          ← All jobs
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">{job.title}</h1>
        <p className="mt-1 text-slate-600">{job.school.name}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700">
            {EMPLOYMENT_LABEL[job.employmentType]}
          </span>
          {job.subject && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{job.subject}</span>
          )}
          {job.posts > 1 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
              {job.posts} positions
            </span>
          )}
          {pay && <span className="font-semibold text-slate-700">{pay}</span>}
          {job.applyBy && (
            <span className="text-slate-500">
              Apply by {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(job.applyBy))}
            </span>
          )}
        </div>

        <div className="mt-8 whitespace-pre-line text-slate-700">{job.description}</div>

        <section className="mt-12 rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Apply</h2>
          <p className="mt-1 text-sm text-slate-500">
            No account needed. {job.school.name} sees your application directly.
          </p>
          <div className="mt-5">
            <ApplyForm jobId={job.id} questions={job.questions ?? []} />
          </div>
        </section>
      </div>
    </div>
  );
}
