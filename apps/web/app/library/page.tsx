'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import {
  copyStateLabel,
  memberLine,
  timeLabel,
  type CopyCard,
  type DeskDayRow,
  type EnrolmentReport,
  type LibraryStatus,
  type MemberCard,
  type NotReturnedRow,
} from '@/lib/library-desk';

/**
 * The counter.
 *
 * ONE scrolling screen, ordered by how often a librarian does each thing — not
 * a dashboard, and not a tab bar. She has this open all day and will not
 * navigate; anything below the fold that is not urgent is never seen.
 *
 * WHAT IS NOT HERE YET, and why it is absent rather than disabled: taking a
 * book back and giving one out are WRITES, and the issue/return/renew logic
 * lives in `apps/library-api/src/modules/circulation/` behind database
 * constraints and a policy module with its own spec. `apps/api` cannot import
 * it, and a second implementation would give two different answers to "what
 * does this child owe" — which is the one failure the money design exists to
 * prevent. So the reads ship first and the counter field arrives with the
 * shared-package extraction. A field that eats keystrokes and does nothing is
 * worse than an absent one.
 *
 * NO MONEY ANYWHERE ON THIS SCREEN. Not a fine stamp on a late row, not a
 * total, not ₹0. A `LOST` fine is only ever created by a deliberate human
 * action with the amount and its source visible at that moment; if a number a
 * parent pays can appear on a screen nobody opened for that purpose, the
 * failure is not an angry parent — it is the librarian quietly stopping
 * reporting losses, and then the register is wrong forever.
 */
export default function LibraryCounterPage(): React.JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [number, setNumber] = useState('');

  const status = useQuery({
    queryKey: ['library-desk', 'status'],
    queryFn: () => api.get<LibraryStatus>('/manage/library/status'),
  });

  const enrol = useMutation({
    mutationFn: () => api.post<EnrolmentReport>('/manage/library/enrol', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library-desk'] }),
  });

  // Two characters is the API's own floor; asking earlier returns [] anyway and
  // costs a request per keystroke.
  const people = useQuery({
    queryKey: ['library-desk', 'members', term],
    enabled: term.trim().length >= 2,
    queryFn: () => api.get<MemberCard[]>(`/manage/library/members?q=${encodeURIComponent(term.trim())}`),
  });

  const copy = useQuery({
    queryKey: ['library-desk', 'copy', number],
    enabled: number.trim().length >= 1,
    queryFn: () =>
      api.get<CopyCard | null>(`/manage/library/copies/${encodeURIComponent(number.trim())}`),
  });

  const day = useQuery({
    queryKey: ['library-desk', 'day'],
    queryFn: () => api.get<DeskDayRow[]>('/manage/library/day'),
  });

  const late = useQuery({
    queryKey: ['library-desk', 'not-returned'],
    queryFn: () => api.get<NotReturnedRow[]>('/manage/library/not-returned'),
  });

  if (status.isPending) return <p className="sk-lib-empty">Loading…</p>;

  // ── First run. Check in order and render the FIRST match: each state has one
  // next action, and she never sees a counter she cannot use. ────────────────

  if (status.data && !status.data.provisioned) {
    return (
      <section className="sk-lib">
        <h1>Library</h1>
        <h2 className="sk-lib-h2">Not set up yet</h2>
        <p className="sk-lib-empty">
          Your school has not switched the library on. Ask the office to set it up, then sign in
          again.
        </p>
      </section>
    );
  }

  // Members before books, deliberately: signing everyone up is one button and
  // instant, while stocking the shelves takes an afternoon. Put the cheap
  // unblock first so the members are already there when the books arrive.
  if (status.data && status.data.members === 0) {
    return (
      <section className="sk-lib">
        <h1>Library</h1>
        <h2 className="sk-lib-h2">Nobody is signed up yet</h2>
        <p className="sk-lib-empty">
          Sign up every student and teacher from the school&rsquo;s own list. You can press this
          again in April when the new children join — it never changes anyone already signed up.
        </p>
        <div className="sk-desk-actions">
          <button className="sk-btn" data-variant="primary" onClick={() => enrol.mutate()} disabled={enrol.isPending}>
            {enrol.isPending ? 'Signing everyone up…' : 'Sign everyone up'}
          </button>
        </div>
        {enrol.data ? (
          <p className="sk-lib-nudge">
            {enrol.data.enrolled} signed up.
            {enrol.data.skippedNoLogin > 0
              ? ` ${enrol.data.skippedNoLogin} do not have a login yet — the office can add those.`
              : ''}
          </p>
        ) : null}
        {enrol.isError ? <p className="sk-lib-empty">That did not save. Nothing has been changed.</p> : null}
      </section>
    );
  }

  if (status.data && status.data.copies === 0) {
    return (
      <section className="sk-lib">
        <h1>Library</h1>
        <h2 className="sk-lib-h2">The shelves are empty</h2>
        {/* Saying this converts "why is nothing working" into "the children
            cannot see it yet either", which is both true and the motivation to
            add the books: `statusFor()` sets live = copies > 0 precisely so a
            student never opens a Library tab onto an empty shelf. */}
        <p className="sk-lib-empty">
          Add your first book and the counter opens. Until there is at least one book, the children
          do not see a Library tab either. Books are added in the library console for now.
        </p>
      </section>
    );
  }

  const lateRows = late.data ?? [];
  const dayRows = day.data ?? [];

  return (
    <section className="sk-lib">
      <h1>Library</h1>
      <p className="sk-lib-nudge">
        {status.data?.members} signed up · {status.data?.copies} books in the register
      </p>

      {/* ── Find a book, or find out who has one ───────────────────────────── */}
      <h2 className="sk-lib-h2">Find a book</h2>
      <input
        className="sk-lib-search"
        type="search"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="Book number"
        aria-label="Find a book by its number"
      />
      <p className="sk-lib-nudge">The number written inside the front cover.</p>
      {copy.data ? (
        <ul className="sk-lib-shelf">
          <li className="sk-lib-shelf-row">
            <span className="sk-lib-no">{copy.data.accessionNumber}</span>
            <span className="sk-lib-title">{copy.data.title}</span>
            {copy.data.author ? <span className="sk-lib-author">{copy.data.author}</span> : null}
            {copy.data.out ? (
              <span className="sk-lib-avail" data-out="true">
                with {copy.data.out.memberName}
                {copy.data.out.classRef ? `, ${copy.data.out.classRef}` : ''} ·{' '}
                {copyStateLabel(copy.data.out)}
              </span>
            ) : (
              <span className="sk-lib-avail" data-out="false">
                on the shelf
              </span>
            )}
          </li>
        </ul>
      ) : null}
      {copy.isFetched && number.trim().length >= 1 && !copy.data ? (
        <p className="sk-lib-empty">That number is not in the register.</p>
      ) : null}

      {/* ── Find a child ───────────────────────────────────────────────────── */}
      <h2 className="sk-lib-h2">Find a child</h2>
      <input
        className="sk-lib-search"
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Name, class or borrower number"
        aria-label="Find a member"
      />
      {people.data && people.data.length > 0 ? (
        <ul className="sk-lib-shelf">
          {people.data.map((m) => (
            <li key={m.memberId} className="sk-lib-shelf-row">
              <span className="sk-lib-child">{m.name}</span>
              {/* Class, books out and borrower number — never what they owe.
                  Money at a counter is a deliberate act, not a search result. */}
              <span className="sk-lib-author">{memberLine(m)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {people.isFetched && term.trim().length >= 2 && people.data?.length === 0 ? (
        <p className="sk-lib-empty">Nobody by that name.</p>
      ) : null}

      {/* ── Today ──────────────────────────────────────────────────────────── */}
      <h2 className="sk-lib-h2">Today</h2>
      {dayRows.length > 0 ? (
        <ul className="sk-lib-shelf">
          {dayRows.map((r, i) => (
            <li key={`${r.issueId}-${r.kind}-${i}`} className="sk-lib-shelf-row">
              <span className="sk-lib-no">{timeLabel(r.at)}</span>
              <span className="sk-lib-title">{r.title}</span>
              <span className="sk-lib-author">{r.memberName}</span>
              <span className="sk-lib-avail" data-out={r.kind === 'ISSUED' ? 'true' : 'false'}>
                {r.kind === 'ISSUED' ? 'given out' : 'taken back'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sk-lib-empty">Nothing yet today.</p>
      )}

      {/* ── Not returned ───────────────────────────────────────────────────── */}
      <h2 className="sk-lib-h2">
        {lateRows.length === 0
          ? 'Not returned'
          : lateRows.length === 1
            ? '1 book not returned'
            : `${lateRows.length} books not returned`}
      </h2>
      {lateRows.length > 0 ? (
        <>
          <ul className="sk-lib-class">
            {lateRows.map((r) => (
              <li key={r.issueId} className="sk-lib-class-row">
                <span className="sk-lib-child">{r.memberName}</span>
                <span className="sk-lib-title">{r.title}</span>
                <span className="sk-lib-no">no. {r.accessionNumber}</span>
                {/* Days, never rupees — a staffroom is a public place, and the
                    moment this shows what a child owes it stops being a nudge
                    list and becomes fee collection. */}
                <span className="sk-lib-state" data-tone="late">
                  {r.daysLate === 1 ? '1 day late' : `${r.daysLate} days late`}
                </span>
              </li>
            ))}
          </ul>
          <p className="sk-lib-nudge">
            A word from the class teacher is what brings these back.
          </p>
        </>
      ) : (
        <p className="sk-lib-empty">Nothing is late. Every book is back or still in time.</p>
      )}
    </section>
  );
}
