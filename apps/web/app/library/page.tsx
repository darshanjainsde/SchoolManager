'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import {
  backByLongLabel,
  copyStateLabel,
  memberLine,
  returnLine,
  timeLabel,
  type CopyCard,
  type DeskDayRow,
  type EnrolmentReport,
  type IssueReceipt,
  type LibraryStatus,
  type MemberCard,
  type NotReturnedRow,
  type ReturnReceipt,
} from '@/lib/library-desk';

/**
 * The counter.
 *
 * ONE scrolling screen, ordered by how often a librarian does each thing — not
 * a dashboard, and not a tab bar. She has this open all day and will not
 * navigate; anything below the fold that is not urgent is never seen.
 *
 * RETURN IS THE DEFAULT MODE. It is the higher-volume action AND the cheaper
 * one — a return needs no member, just the number inside the front cover, so
 * it is one field and one keystroke pattern. Defaulting to Issue would cost a
 * mode switch on every burst of forty returns at the start of a period.
 *
 * The child stays CHOSEN between issues. She picks Aarav once and then types
 * number after number; clearing him is deliberate. Re-picking per book is the
 * difference between a counter that keeps up with a queue and one that does
 * not.
 *
 * Issue and return call `@library/core` — the same functions the library
 * console runs, not a second implementation. That is what stops the two
 * consoles disagreeing about what a child owes.
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

  // ── The counter ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'return' | 'issue'>('return');
  const [child, setChild] = useState<MemberCard | null>(null);
  const [deskNumber, setDeskNumber] = useState('');
  const [childTerm, setChildTerm] = useState('');
  const [receipt, setReceipt] = useState<
    { kind: 'returned'; r: ReturnReceipt } | { kind: 'issued'; r: IssueReceipt } | null
  >(null);
  const [deskError, setDeskError] = useState<string | null>(null);

  /** Everything the counter touches, refetched after any write. */
  function refreshDesk() {
    void queryClient.invalidateQueries({ queryKey: ['library-desk'] });
  }

  const takeBack = useMutation({
    mutationFn: (accessionNumber: string) =>
      api.post<ReturnReceipt>('/manage/library/return', { accessionNumber }),
    onSuccess: (r) => {
      setReceipt({ kind: 'returned', r });
      setDeskError(null);
      setDeskNumber('');
      refreshDesk();
    },
    onError: (e: Error) => {
      setReceipt(null);
      setDeskError(e.message);
    },
  });

  const giveOut = useMutation({
    mutationFn: ({ accessionNumber, memberId }: { accessionNumber: string; memberId: string }) =>
      api.post<IssueReceipt>('/manage/library/issue', { accessionNumber, memberId }),
    onSuccess: (r) => {
      setReceipt({ kind: 'issued', r });
      setDeskError(null);
      setDeskNumber('');
      refreshDesk();
    },
    onError: (e: Error) => {
      setReceipt(null);
      setDeskError(e.message);
    },
  });

  const deskBusy = takeBack.isPending || giveOut.isPending;

  // ── Undo ─────────────────────────────────────────────────────────────────
  // Only an issue can be undone, and only while it is still out. `undoing`
  // holds the row being confirmed — the reason is typed, never assumed.
  const [undoing, setUndoing] = useState<DeskDayRow | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [undone, setUndone] = useState<string | null>(null);

  const undo = useMutation({
    mutationFn: ({ issueId, reason }: { issueId: string; reason: string }) =>
      api.post<{ memberName: string; attendanceRemovedFor: string | null }>(
        '/manage/library/undo',
        { issueId, reason },
      ),
    onSuccess: (r) => {
      setUndoing(null);
      setUndoReason('');
      // She is TOLD when the automatic attendance mark went with it, rather
      // than discovering later that a child's register changed.
      setUndone(
        r.attendanceRemovedFor
          ? `Undone. ${r.attendanceRemovedFor} is no longer marked present.`
          : 'Undone.',
      );
      refreshDesk();
    },
    onError: (e: Error) => setDeskError(e.message),
  });

  // Searching for the child to issue to — separate from the "find a child"
  // section further down, which answers a question rather than choosing anyone.
  const deskPeople = useQuery({
    queryKey: ['library-desk', 'members', childTerm],
    enabled: mode === 'issue' && !child && childTerm.trim().length >= 2,
    queryFn: () =>
      api.get<MemberCard[]>(`/manage/library/members?q=${encodeURIComponent(childTerm.trim())}`),
  });

  function submitCounter(e: React.FormEvent) {
    e.preventDefault();
    const n = deskNumber.trim();
    if (!n || deskBusy) return;
    if (mode === 'return') {
      takeBack.mutate(n);
      return;
    }
    if (!child) return;
    giveOut.mutate({ accessionNumber: n, memberId: child.memberId });
  }

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
        <p className="sk-lib-nudge">
          The counter is hidden rather than greyed out — a field that takes a book number when
          there are no books would only ever answer &ldquo;that number is not in the register&rdquo;.
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

      {/* ── The counter ────────────────────────────────────────────────────── */}
      <div className="sk-desk-modes" role="group" aria-label="What are you doing?">
        <button
          type="button"
          className="sk-desk-mode"
          data-on={mode === 'return'}
          onClick={() => {
            setMode('return');
            setReceipt(null);
            setDeskError(null);
          }}
        >
          Take back
        </button>
        <button
          type="button"
          className="sk-desk-mode"
          data-on={mode === 'issue'}
          onClick={() => {
            setMode('issue');
            setReceipt(null);
            setDeskError(null);
          }}
        >
          Give out
        </button>
      </div>

      {/* Choosing the child comes BEFORE the number, and only in issue mode.
          She stays chosen until cleared — book after book without re-picking. */}
      {mode === 'issue' ? (
        child ? (
          <p className="sk-desk-child">
            <strong>{child.name}</strong>
            {child.classRef ? ` · ${child.classRef}` : ''} ·{' '}
            {child.booksOut === 1 ? '1 book out' : `${child.booksOut} books out`}
            <button
              type="button"
              className="sk-desk-clear"
              onClick={() => {
                setChild(null);
                setChildTerm('');
              }}
            >
              Change
            </button>
          </p>
        ) : (
          <>
            <input
              className="sk-lib-search"
              type="search"
              value={childTerm}
              onChange={(e) => setChildTerm(e.target.value)}
              placeholder="Name, class or borrower number"
              aria-label="Choose the child"
            />
            {deskPeople.data && deskPeople.data.length > 0 ? (
              <ul className="sk-lib-shelf">
                {deskPeople.data.map((m) => (
                  <li key={m.memberId} className="sk-lib-shelf-row">
                    <button
                      type="button"
                      className="sk-desk-pick"
                      onClick={() => {
                        setChild(m);
                        setChildTerm('');
                      }}
                    >
                      <span className="sk-lib-child">{m.name}</span>
                      <span className="sk-lib-author">{memberLine(m)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {deskPeople.isFetched && childTerm.trim().length >= 2 && deskPeople.data?.length === 0 ? (
              <p className="sk-lib-empty">Nobody by that name.</p>
            ) : null}
          </>
        )
      ) : null}

      <form onSubmit={submitCounter} className="sk-desk-form">
        <input
          className="sk-lib-search"
          type="text"
          value={deskNumber}
          onChange={(e) => setDeskNumber(e.target.value)}
          // Autofocus is right here and almost nowhere else: this field is the
          // reason the page exists, and she works from a queue, not a mouse.
          autoFocus
          disabled={mode === 'issue' && !child}
          placeholder={mode === 'issue' && !child ? 'Choose a child first' : 'Book number'}
          aria-label={mode === 'return' ? 'Book number to take back' : 'Book number to give out'}
        />
        <button
          className="sk-btn"
          data-variant="primary"
          type="submit"
          disabled={deskBusy || !deskNumber.trim() || (mode === 'issue' && !child)}
        >
          {deskBusy ? 'Saving…' : mode === 'return' ? 'Take back' : 'Give out'}
        </button>
      </form>
      <p className="sk-lib-nudge">The number written inside the front cover.</p>

      {/* The receipt. One line, the same place every time, so she can work
          without reading — the shape of the line is the confirmation. */}
      {receipt?.kind === 'returned' ? (
        <div className="sk-desk-receipt" data-tone={receipt.r.daysLate > 0 ? 'late' : 'calm'}>
          <span className="sk-lib-title">{receipt.r.title}</span>
          <span className="sk-lib-author">
            {receipt.r.memberName}
            {receipt.r.classRef ? `, ${receipt.r.classRef}` : ''}
          </span>
          <span className="sk-lib-state" data-tone={receipt.r.daysLate > 0 ? 'late' : 'calm'}>
            {returnLine(receipt.r)}
          </span>
          {/* Where the next child is waiting for this exact copy. */}
          {receipt.r.promotedReservationId ? (
            <span className="sk-desk-aside">Keep this one aside — it is reserved.</span>
          ) : null}
        </div>
      ) : null}
      {receipt?.kind === 'issued' ? (
        <div className="sk-desk-receipt" data-tone="calm">
          <span className="sk-lib-title">{receipt.r.title}</span>
          <span className="sk-lib-author">
            {receipt.r.memberName}
            {receipt.r.classRef ? `, ${receipt.r.classRef}` : ''}
          </span>
          <span className="sk-lib-state" data-tone="calm">{backByLongLabel(receipt.r.backBy)}</span>
        </div>
      ) : null}
      {deskError ? <p className="sk-lib-empty" role="alert">{deskError}</p> : null}

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
      {undone ? <p className="sk-lib-nudge">{undone}</p> : null}
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
              {/* Only what was GIVEN OUT can be undone. A return is undone by
                  giving the book out again, which is a real counter action —
                  and the API refuses a returned issue anyway. */}
              {r.kind === 'ISSUED' ? (
                <button
                  type="button"
                  className="sk-desk-clear"
                  onClick={() => {
                    setUndoing(r);
                    setUndoReason('');
                    setUndone(null);
                  }}
                >
                  Undo
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sk-lib-empty">Nothing yet today.</p>
      )}

      {undoing ? (
        <div className="sk-desk-receipt" data-tone="late">
          <span className="sk-lib-title">Undo &ldquo;{undoing.title}&rdquo;?</span>
          <span className="sk-lib-author">
            The book goes back on the shelf and nothing is counted.
          </span>
          <input
            className="sk-lib-search"
            value={undoReason}
            onChange={(e) => setUndoReason(e.target.value)}
            placeholder="Wrong number typed"
            aria-label="Why are you undoing this?"
          />
          <div className="sk-desk-actions">
            <button
              className="sk-btn"
              data-variant="primary"
              disabled={undo.isPending || !undoReason.trim()}
              onClick={() => undo.mutate({ issueId: undoing.issueId, reason: undoReason.trim() })}
            >
              {undo.isPending ? 'Undoing…' : 'Undo it'}
            </button>
            <button className="sk-btn" onClick={() => setUndoing(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

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
