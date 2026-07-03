import Link from 'next/link';
import { Globe } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Welcome to your school portal</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your school's online presence from here.</p>
      </header>

      {/* CTA card */}
      <Link
        href="/app/website"
        className="group flex max-w-sm items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-teal-300 hover:shadow-md"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-600 group-hover:bg-teal-100">
          <Globe className="h-5 w-5" />
        </span>
        <div>
          <div className="font-semibold text-slate-900">Edit your website</div>
          <div className="mt-0.5 text-sm text-slate-500">
            Update your homepage, gallery, and contact info.
          </div>
        </div>
      </Link>
    </div>
  );
}
