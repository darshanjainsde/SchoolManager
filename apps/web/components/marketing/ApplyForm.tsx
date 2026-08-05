'use client';
import { useState } from 'react';
import type { PublicJobQuestion } from '@/lib/jobs-api';

/**
 * Applying, with no account.
 *
 * The CV is a LINK, not a file: every upload path in this product is
 * authenticated, and a public endpoint accepting binaries from strangers would
 * be the largest single risk in this feature. See the design spec §2.
 */
export default function ApplyForm({ jobId, questions }: { jobId: string; questions: PublicJobQuestion[] }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      const res = await fetch(`${base}/public/jobs/${jobId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? '').trim(),
          email: String(form.get('email') ?? '').trim(),
          phone: String(form.get('phone') ?? '').trim() || undefined,
          cvUrl: String(form.get('cvUrl') ?? '').trim(),
          answers,
        }),
      });
      if (res.status === 429) setError('Too many attempts just now — please try again in a minute.');
      else if (res.status === 400) setError('This role is no longer open for applications.');
      else if (!res.ok) setError('That could not be sent. Please try again.');
      else setDone(true);
    } catch {
      setError('That could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h3 className="font-bold text-emerald-900">Application sent</h3>
        {/* Nothing here sends mail, so nothing here promises it. */}
        <p className="mt-1 text-sm text-emerald-800">
          It is on the school&rsquo;s desk. They will contact you directly if they want to take it further.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-semibold text-slate-700">
        Your name
        <input name="name" required className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-slate-700">
        Email
        <input type="email" name="email" required className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-slate-700">
        Phone <span className="font-normal text-slate-400">(optional)</span>
        <input name="phone" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-slate-700">
        Link to your CV
        <input
          name="cvUrl"
          type="url"
          required
          placeholder="https://drive.google.com/…"
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Paste a link the school can open — Drive, Dropbox or LinkedIn. Check it is shared, not private.
        </span>
      </label>

      {questions.map((q) => (
        <label key={q.id} className="block text-sm font-semibold text-slate-700">
          {q.prompt}
          {q.kind === 'CHOICE' && (
            <select
              required={q.required}
              defaultValue=""
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
            >
              <option value="" disabled>
                Choose…
              </option>
              {q.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {q.kind === 'YES_NO' && (
            <select
              required={q.required}
              defaultValue=""
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value === 'yes' }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
            >
              <option value="" disabled>
                Choose…
              </option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          )}
          {q.kind === 'NUMBER' && (
            <input
              type="number"
              min={0}
              required={q.required}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: Number(e.target.value) }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
            />
          )}
          {q.kind === 'TEXT' && (
            <textarea
              rows={3}
              required={q.required}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
            />
          )}
        </label>
      ))}

      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send application'}
      </button>
    </form>
  );
}
