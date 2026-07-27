import Link from 'next/link';

/**
 * Branded 404. Reached both by unknown URLs and by every explicit `notFound()`
 * call — e.g. /pricing on a school host, or a blog slug that doesn't exist.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-violet-600 text-xl font-black text-white">
          S
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-teal-600">404</p>
        <h1 className="mt-1 text-lg font-bold text-slate-900">This page isn&rsquo;t here</h1>
        <p className="mt-2 text-sm text-slate-500">
          The link may be out of date, or the page may belong to a different school&rsquo;s site.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-teal-600/25 transition hover:-translate-y-0.5"
        >
          Go to the homepage
        </Link>
      </div>
    </div>
  );
}
