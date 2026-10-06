'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Megaphone, Plus } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Cell, Field, FieldRow, Figure, Figures, Note, Overlay, Row, RowList, RowTitle, ScrollBox, ShowMore } from '@/components/ui/kit';
import {
  audienceOf, groupNotices, postedAtLabel, whenLabel,
  type AnnouncementRow, type Notice,
} from './notices';

/**
 * THE ANNOUNCEMENTS DESK.
 *
 * Answering the three questions before the markup (see the ui-mistake-ledger):
 *
 * 1. HOW BIG DOES THIS GET? A school posts two to five notices a week, so a
 *    year is a couple of hundred — and because the API writes ONE ROW PER
 *    TARGETED CLASS, a single notice to fifteen classes is fifteen rows. The
 *    sample school already shows 22 rows for 12 notices. So: group the rows
 *    into notices (notices.ts), and show twelve with a "show more".
 * 2. WHAT IS THE ADMIN LOOKING FOR? "The notice I sent about the PTM" — and
 *    then "who got it". The noun is the NOTICE; the audience is its detail.
 * 3. WHAT IS THE LONGEST VALUE? A title that is a whole sentence, a message of
 *    several paragraphs, and an audience of thirty class names. So the title
 *    column is the flexible one, the message is clamped to two lines, and the
 *    audience names three classes and counts the rest.
 *
 * What it replaces: a Tailwind table with the message cut to one line of 12px
 * grey, an audience pill reading "B" (which of the fifteen Bs?), a compose
 * card in flow that pushed the list below the fold, no way to fix a typo, and
 * a red Delete on every row with no confirmation — a wall of red down a page
 * whose rows are things already sent to families.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface SchoolClass {
  id: string;
  name: string;
  grade: { name: string };
  /** The API includes the year so last year's sections are not offered. */
  academicYear?: { isCurrent: boolean } | null;
  _count: { students: number };
}

/** What WhatsApp is told when the notice is one of the three it has a narrow template for. */
type NoticeTopicBody =
  | { kind: 'HOLIDAY'; closedOn: string; occasion: string; resumesOn: string }
  | { kind: 'PTM'; on: string; at: string }
  | { kind: 'TIMING'; on: string; from: string; to: string };

interface CreateAnnouncementBody {
  title: string;
  body: string;
  classSectionIds?: string[];
  topic?: NoticeTopicBody;
}

type TopicKind = 'GENERAL' | 'HOLIDAY' | 'PTM' | 'TIMING';
const TOPIC_LABEL: Record<TopicKind, string> = { GENERAL: 'General', HOLIDAY: 'Holiday', PTM: "Parents' meeting", TIMING: 'Timing change' };

// Fixed names, never toLocaleDateString: ICU prints "Sept" for September.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-11' -> '11 Oct'; '' until the admin has picked a real date. */
function dayMonth(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return '';
  return `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}`;
}

/** Today as the browser's calendar day, 'YYYY-MM-DD' — the earliest a notice's date may be. The server is the real gate. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** What the title says until the admin writes their own. */
function suggestedTitle(kind: TopicKind, f: { closedOn: string; occasion: string; on: string }): string {
  if (kind === 'HOLIDAY') {
    const d = dayMonth(f.closedOn), why = f.occasion.trim();
    return d && why ? `School closed on ${d} for ${why}` : '';
  }
  const d = dayMonth(f.on);
  if (!d) return '';
  return kind === 'PTM' ? `Parents' meeting on ${d}` : kind === 'TIMING' ? `School timings change on ${d}` : '';
}

/** The drawer is one layer with four jobs — never a dialog on top of a drawer. */
type Panel =
  | { kind: 'new' }
  | { kind: 'read'; notice: Notice }
  | { kind: 'edit'; notice: Notice }
  | { kind: 'delete'; notice: Notice }
  | null;

const PAGE = 12;

// ── The audience picker ──────────────────────────────────────────────────────

interface GradeGroup { grade: string; sections: SchoolClass[] }

/** Classes come back ordered by grade then section, so grouping keeps that order. */
function byGrade(classes: SchoolClass[]): GradeGroup[] {
  const out: GradeGroup[] = [];
  for (const c of classes) {
    const open = out[out.length - 1];
    if (open && open.grade === c.grade.name) open.sections.push(c);
    else out.push({ grade: c.grade.name, sections: [c] });
  }
  return out;
}

/**
 * Forty-five sections is far past the handful a flat row of chips can hold —
 * the ledger's rule is chips below about seven, something else above it. The
 * something else here is the school's own hierarchy: a row per grade, its
 * sections beside it, and the grade's own chip takes or drops all three at
 * once. That is how an admin says it out loud: "all of class nine".
 */
function AudiencePicker({
  classes, selected, onChange, disabled,
}: {
  classes: SchoolClass[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const grades = useMemo(() => byGrade(classes), [classes]);
  const chosen = new Set(selected);

  const toggleOne = (id: string) =>
    onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const toggleGrade = (g: GradeGroup) => {
    const ids = g.sections.map((s) => s.id);
    const all = ids.every((id) => chosen.has(id));
    onChange(all ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])]);
  };

  if (classes.length === 0) return <p className="sk-state">This school has no classes yet.</p>;

  return (
    <ScrollBox label="Classes to announce to" max={300}>
      <div className="sk-annpick">
        {grades.map((g) => {
          const ids = g.sections.map((s) => s.id);
          const all = ids.every((id) => chosen.has(id));
          return (
            <div className="g" key={g.grade}>
              <button
                type="button"
                className="sk-chip sk-anngrade"
                aria-pressed={all}
                disabled={disabled}
                onClick={() => toggleGrade(g)}
              >
                {g.grade}
              </button>
              <div className="s">
                {g.sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="sk-chip"
                    aria-pressed={chosen.has(s.id)}
                    disabled={disabled}
                    onClick={() => toggleOne(s.id)}
                  >
                    {s.name}
                    <span className="n">{s._count.students}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollBox>
  );
}

// ── The composer ─────────────────────────────────────────────────────────────

function Composer({
  classes, saving, initial, onSubmit,
}: {
  classes: SchoolClass[];
  saving: boolean;
  /** Set when editing: the words are prefilled and the audience is fixed. */
  initial?: Notice;
  onSubmit: (data: { title: string; body: string; classSectionIds: string[]; whole: boolean; topic?: NoticeTopicBody }) => void;
}) {
  const editing = !!initial;
  const today = useMemo(todayLocal, []);
  const [kind, setKind] = useState<TopicKind>('GENERAL');
  const [closedOn, setClosedOn] = useState('');
  const [occasion, setOccasion] = useState('');
  const [resumesOn, setResumesOn] = useState('');
  const [on, setOn] = useState('');
  const [at, setAt] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // The title follows the details until the admin writes one of their own.
  const [typedTitle, setTypedTitle] = useState(initial?.title ?? '');
  const title = editing || typedTitle !== '' ? typedTitle : suggestedTitle(kind, { closedOn, occasion, on });
  const [body, setBody] = useState(initial?.body ?? '');
  const [whole, setWhole] = useState(initial ? initial.audience === 'SCHOOL' : true);
  const [picked, setPicked] = useState<string[]>([]);

  const reach = classes.filter((c) => picked.includes(c.id)).reduce((n, c) => n + c._count.students, 0);
  const topic: NoticeTopicBody | null =
    kind === 'HOLIDAY' && closedOn && occasion.trim() && resumesOn ? { kind, closedOn, occasion: occasion.trim(), resumesOn }
    : kind === 'PTM' && on && at ? { kind, on, at }
    : kind === 'TIMING' && on && from && to ? { kind, on, from, to }
    : null;
  const topicReady = editing || kind === 'GENERAL' || topic !== null;
  const ready = title.trim() && body.trim() && (whole || picked.length > 0) && topicReady;

  return (
    <form
      id="ann-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || saving) return;
        onSubmit({ title: title.trim(), body: body.trim(), classSectionIds: picked, whole, ...(topic && !editing ? { topic } : {}) });
      }}
      className="flex flex-col gap-4"
    >
      {!editing && (
        <div className="sk-field">
          <span className="sk-lab">What is it?</span>
          <div
            className="sk-seg"
            role="group"
            aria-label="What is it?"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}
          >
            {(Object.keys(TOPIC_LABEL) as TopicKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{TOPIC_LABEL[k]}</button>
            ))}
          </div>
          {kind !== 'GENERAL' && (
            <p className="sk-muted">WhatsApp sends these details in a fixed message. The app and email show your title and message.</p>
          )}
        </div>
      )}

      {!editing && kind === 'HOLIDAY' && (
        <>
          <FieldRow min={150}>
            <Field id="ann-closed" label="Closed on">
              {(p) => <input {...p} type="date" min={today} className="sk-input" value={closedOn} onChange={(e) => setClosedOn(e.target.value)} />}
            </Field>
            <Field id="ann-resumes" label="Classes resume">
              {(p) => <input {...p} type="date" min={today} className="sk-input" value={resumesOn} onChange={(e) => setResumesOn(e.target.value)} />}
            </Field>
          </FieldRow>
          <Field id="ann-occasion" label="For">
            {(p) => (
              <input {...p} type="text" className="sk-input" value={occasion} maxLength={60} placeholder="Diwali"
                onChange={(e) => setOccasion(e.target.value)} />
            )}
          </Field>
        </>
      )}

      {!editing && kind === 'PTM' && (
        <FieldRow min={150}>
          <Field id="ann-on" label="Date">
            {(p) => <input {...p} type="date" min={today} className="sk-input" value={on} onChange={(e) => setOn(e.target.value)} />}
          </Field>
          <Field id="ann-at" label="Time">
            {(p) => <input {...p} type="time" className="sk-input" value={at} onChange={(e) => setAt(e.target.value)} />}
          </Field>
        </FieldRow>
      )}

      {!editing && kind === 'TIMING' && (
        <FieldRow min={110}>
          <Field id="ann-on" label="Date">
            {(p) => <input {...p} type="date" min={today} className="sk-input" value={on} onChange={(e) => setOn(e.target.value)} />}
          </Field>
          <Field id="ann-from" label="From">
            {(p) => <input {...p} type="time" className="sk-input" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field id="ann-to" label="To">
            {(p) => <input {...p} type="time" className="sk-input" value={to} onChange={(e) => setTo(e.target.value)} />}
          </Field>
        </FieldRow>
      )}

      <Field id="ann-title" label="Title">
        {(p) => (
          <input
            {...p}
            className="sk-input"
            value={title}
            onChange={(e) => setTypedTitle(e.target.value)}
            placeholder="Parent–Teacher Meeting on Saturday"
            maxLength={160}
            autoFocus
          />
        )}
      </Field>

      <Field
        id="ann-body"
        label="Message"
        hint="Families read this in the app and in their email, exactly as written."
      >
        {(p) => (
          <textarea
            {...p}
            className="sk-input"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write it the way you would say it to a parent."
          />
        )}
      </Field>

      {editing ? (
        // Retargeting is not an edit: the rows ARE the audience, and PATCH can
        // neither add a class nor drop one. Say so rather than offer a control
        // that would quietly do nothing.
        <Note>
          This goes to <strong>{audienceOf(initial).summary.toLowerCase()}</strong> and that cannot be changed here.
          To send it elsewhere, delete it and post again.
        </Note>
      ) : (
        <div className="sk-field">
          <span className="sk-lab">Who gets it</span>
          <div className="sk-seg" role="group" aria-label="Who gets it">
            <button type="button" aria-pressed={whole} onClick={() => setWhole(true)}>Whole school</button>
            <button type="button" aria-pressed={!whole} onClick={() => setWhole(false)}>Chosen classes</button>
          </div>
          {!whole && (
            <div className="mt-2 flex flex-col gap-2">
              <AudiencePicker classes={classes} selected={picked} onChange={setPicked} disabled={saving} />
              {picked.length === 0 ? (
                <Note>Pick at least one class, or send it to the whole school.</Note>
              ) : (
                <p className="sk-muted">
                  {picked.length} {picked.length === 1 ? 'class' : 'classes'} · {reach}{' '}
                  {reach === 1 ? 'student' : 'students'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [panel, setPanel] = useState<Panel>(null);
  const [shown, setShown] = useState(PAGE);

  const list = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get<AnnouncementRow[]>('/manage/announcements'),
    enabled: !!host,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    enabled: !!host,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // `/manage/classes` carries every year's sections unless asked for one, and
  // last June's classes are not somewhere to send today's notice.
  const classes = (classesQuery.data ?? []).filter((c) => c.academicYear?.isCurrent !== false);

  const notices = useMemo(() => groupNotices(list.data ?? []), [list.data]);
  const toSchool = notices.filter((n) => n.audience === 'SCHOOL').length;

  const close = () => setPanel(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements'] });

  const create = useMutation({
    mutationFn: (data: CreateAnnouncementBody) => api.post<unknown>('/manage/announcements', data),
    onSuccess: () => { void refresh(); close(); toast.success('Announcement posted.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * A notice is several rows, so editing and deleting are several calls. They
   * run together and the result is reported HONESTLY — a half-applied change
   * on an outward-facing thing is exactly what an admin needs to be told
   * about, not something to hide behind a cheerful toast.
   */
  const applyToRows = async (rows: AnnouncementRow[], fn: (id: string) => Promise<unknown>) => {
    const done = await Promise.allSettled(rows.map((r) => fn(r.id)));
    const failed = done.filter((d) => d.status === 'rejected').length;
    return { ok: done.length - failed, failed };
  };

  const edit = useMutation({
    mutationFn: async (v: { notice: Notice; title: string; body: string }) =>
      applyToRows(v.notice.rows, (id) => api.patch<unknown>(`/manage/announcements/${id}`, { title: v.title, body: v.body })),
    onSuccess: (r) => {
      void refresh();
      close();
      if (r.failed === 0) toast.success('Announcement updated.');
      else toast.error(`Updated ${r.ok} of ${r.ok + r.failed} copies — reopen it and try the rest.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (notice: Notice) =>
      applyToRows(notice.rows, (id) => api.del<unknown>(`/manage/announcements/${id}`)),
    onSuccess: (r) => {
      void refresh();
      close();
      if (r.failed === 0) toast.success('Announcement deleted.');
      else toast.error(`Deleted ${r.ok} of ${r.ok + r.failed} copies — reopen it and try the rest.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = create.isPending || edit.isPending || remove.isPending;

  return (
    <>
      <header className="sk-pagehead">
        <div>
          <h1>Announcements</h1>
          <p>What the school has told families, and who it went to.</p>
        </div>
        <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setPanel({ kind: 'new' })}>
          <Plus className="h-4 w-4" aria-hidden="true" /> New announcement
        </button>
      </header>

      {notices.length > 0 && (
        <Figures count={3}>
          <Figure value={notices.length} label="Notices" />
          <Figure value={toSchool} label="To the whole school" />
          <Figure value={notices.length - toSchool} label="To chosen classes" />
        </Figures>
      )}

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Posted</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            {list.isLoading ? 'Loading…' : `${notices.length} ${notices.length === 1 ? 'notice' : 'notices'}, newest first`}
          </p>
        </div>
        <div className="sk-card-b">
          {/* A failed load keeps whatever is on screen and offers the retry —
              blanking to the empty state would tell the admin nothing was ever
              posted, which is a different and much worse sentence. */}
          {list.error && (
            <Note tone="bad">
              {(list.error as Error).message}
              <button type="button" className="sk-btn" data-size="sm" style={{ marginLeft: 10 }} onClick={() => void list.refetch()}>
                Try again
              </button>
            </Note>
          )}

          {list.isLoading && <p className="sk-state">Loading announcements…</p>}

          {!list.isLoading && !list.error && notices.length === 0 && (
            <div className="sk-annempty">
              <Megaphone className="h-9 w-9" aria-hidden="true" />
              <h4>Nothing posted yet</h4>
              <p>
                Holidays, exam dates, a change of timing — whatever the whole school or one class needs to
                know. It reaches families in the app and by email.
              </p>
              <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setPanel({ kind: 'new' })}>
                Write the first one
              </button>
            </div>
          )}

          {notices.length > 0 && (
            <>
              <RowList columns="minmax(0, 1fr) auto auto" label="Announcements">
                {notices.slice(0, shown).map((n) => {
                  const a = audienceOf(n);
                  return (
                    <Row key={n.key} onClick={() => setPanel({ kind: 'read', notice: n })}>
                      <Cell>
                        <RowTitle title={n.title} sub={<span className="sk-annbody">{n.body}</span>} />
                      </Cell>
                      <Cell>
                        <span className="sk-pill" data-tone={n.audience === 'SCHOOL' ? 'info' : 'neutral'}>
                          {a.summary}
                        </span>
                        {a.shown.length > 0 && (
                          <span className="sk-annwho">
                            {a.shown.join(', ')}{a.more > 0 ? ` +${a.more}` : ''}
                          </span>
                        )}
                      </Cell>
                      <Cell align="end">
                        <span className="sk-annwhen">{whenLabel(n.postedAt)}</span>
                      </Cell>
                    </Row>
                  );
                })}
              </RowList>
              <ShowMore
                hidden={notices.length - shown}
                expanded={shown > PAGE}
                onShow={() => setShown((s) => s + 40)}
                onLess={() => setShown(PAGE)}
              />
            </>
          )}
        </div>
      </div>

      {panel?.kind === 'new' && (
        <Overlay
          title="New announcement"
          subtitle="It reaches families in the app and by email."
          onClose={close}
          footer={
            <>
              <button type="button" className="sk-btn" onClick={close} disabled={busy}>Cancel</button>
              <button type="submit" form="ann-form" className="sk-btn sk-press" data-variant="primary" disabled={busy}>
                {create.isPending ? 'Posting…' : 'Post announcement'}
              </button>
            </>
          }
        >
          <Composer
            classes={classes}
            saving={busy}
            onSubmit={(v) =>
              create.mutate({
                title: v.title,
                body: v.body,
                ...(v.whole ? {} : { classSectionIds: v.classSectionIds }),
                ...(v.topic ? { topic: v.topic } : {}),
              })
            }
          />
        </Overlay>
      )}

      {panel?.kind === 'read' && (
        <Overlay
          title={panel.notice.title}
          subtitle={postedAtLabel(panel.notice.postedAt)}
          onClose={close}
          footer={
            <>
              <button type="button" className="sk-btn" data-tone="bad" onClick={() => setPanel({ kind: 'delete', notice: panel.notice })}>
                Delete
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setPanel({ kind: 'edit', notice: panel.notice })}>
                Edit wording
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="sk-annread">{panel.notice.body}</p>
            <div className="sk-field">
              <span className="sk-lab">Who got it</span>
              {panel.notice.audience === 'SCHOOL' ? (
                <p className="sk-muted">Every family in the school.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {panel.notice.classNames.map((c) => (
                    <span key={c} className="sk-pill" data-tone="neutral">{c}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Overlay>
      )}

      {panel?.kind === 'edit' && (
        <Overlay
          title="Edit announcement"
          subtitle={`Posted ${postedAtLabel(panel.notice.postedAt)}`}
          onClose={close}
          footer={
            <>
              <button type="button" className="sk-btn" onClick={() => setPanel({ kind: 'read', notice: panel.notice })} disabled={busy}>
                Back
              </button>
              <button type="submit" form="ann-form" className="sk-btn sk-press" data-variant="primary" disabled={busy}>
                {edit.isPending ? 'Saving…' : 'Save wording'}
              </button>
            </>
          }
        >
          <Composer
            classes={classes}
            saving={busy}
            initial={panel.notice}
            onSubmit={(v) => edit.mutate({ notice: panel.notice, title: v.title, body: v.body })}
          />
        </Overlay>
      )}

      {panel?.kind === 'delete' && (
        <Overlay
          title="Delete this announcement?"
          side="center"
          onClose={close}
          footer={
            <>
              <button type="button" className="sk-btn" onClick={() => setPanel({ kind: 'read', notice: panel.notice })} disabled={busy}>
                Keep it
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="sk-btn sk-press" data-tone="bad" disabled={busy} onClick={() => remove.mutate(panel.notice)}>
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="sk-annread" style={{ fontWeight: 600 }}>{panel.notice.title}</p>
            <p className="sk-muted">
              Sent to {audienceOf(panel.notice).summary.toLowerCase()} on {postedAtLabel(panel.notice.postedAt)}.
            </p>
            {/* The honest consequence: the row goes, the message that already
                landed on a parent's phone does not come back. */}
            <Note>
              It disappears from the families’ app. The message already sent to their phones and email cannot be
              taken back.
            </Note>
          </div>
        </Overlay>
      )}
    </>
  );
}
