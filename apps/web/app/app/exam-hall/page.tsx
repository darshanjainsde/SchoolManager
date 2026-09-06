'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Plus, Printer, Trash2 } from 'lucide-react';
import type {
  PlannedSeat,
  RoomRow,
  SavedSeatingPlan,
  SeatingPlanResult,
  SeatingPlanSummary,
  SeatingRules,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { PrintSheets, SheetPreview, SHEETS, type Sheet } from './print-sheets';
import type { RoomShape } from './room-grid';
import {
  RoomGrid,
  capacityOf,
  clashesIn,
  deskCount,
  describeNeighbours,
  deskKey,
  toneFor,
} from './room-grid';
import './print.css';

/**
 * Exam Hall — one screen in the office, paper everywhere else.
 *
 * Teachers do not carry phones into an exam room, so nothing here needs one.
 * The office draws its rooms once, ticks which classes sit in one, presses a
 * button, and prints. Three steps, and the third one ends at a printer.
 *
 * Classes, sections, roll numbers and students are NOT configured here — they
 * are already in Sckools, and this screen only reads them. The single new fact
 * a school has to supply is the shape of its rooms.
 */

// ── shapes the screen works in ───────────────────────────────────────────────

interface SchoolClass {
  id: string;
  name: string;
  grade: { name: string };
  _count: { students: number };
}

interface RoomDraft {
  /** Null while adding a room that has never been saved. */
  id: string | null;
  name: string;
  rows: number;
  cols: number;
  seatsPerDesk: number;
  removedDesks: string[];
}

const NEW_ROOM: RoomDraft = { id: null, name: '', rows: 6, cols: 6, seatsPerDesk: 1, removedDesks: [] };

const RULE_TEXT: { key: keyof SeatingRules; label: string; sub: string }[] = [
  { key: 'noClassmates', label: 'Classmates never sit together', sub: 'Not beside, not in front, not behind.' },
  {
    key: 'alternateCols',
    label: 'Two classes, alternate columns',
    sub: 'Different paper side by side, so copying is useless.',
  },
  {
    key: 'spreadRolls',
    label: 'Roll numbers spread out',
    sub: 'Matters when one class fills a room on its own.',
  },
  { key: 'backRowFree', label: 'Back row stays empty', sub: 'So the teacher can stand behind everyone.' },
];

const DEFAULT_RULES: SeatingRules = {
  noClassmates: true,
  alternateCols: true,
  spreadRolls: true,
  backRowFree: true,
};

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { message?: string } | undefined;
    return body?.message ?? e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

// ── the screen ───────────────────────────────────────────────────────────────

export default function ExamHallPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<RoomDraft>(NEW_ROOM);
  const [dirty, setDirty] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [rules, setRules] = useState<SeatingRules>(DEFAULT_RULES);
  const [title, setTitle] = useState('Half-Yearly');
  const [plan, setPlan] = useState<SeatingPlanResult | null>(null);
  /**
   * The floor the CURRENT plan was made for, which is not always the room in
   * the editor. Reopening a saved plan used to load its old shape straight into
   * `draft`, so the next "Save changes" would quietly revert the live room to
   * whatever it looked like in October. The chart renders on the plan's floor;
   * the editor keeps editing the real room.
   */
  const [planRoom, setPlanRoom] = useState<RoomShape | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  // All five by default: the office wants the bundle, not one sheet at a time.
  const [sheets, setSheets] = useState<Sheet[]>(SHEETS.map((s) => s.key));

  // `enabled: !!host` is not optional here. useHost() resolves only AFTER
  // mount, so a query that fires on the first render sends no Host header, the
  // API cannot resolve the tenant, and the 401 -> failed refresh path calls
  // clear() — which signs the admin out the instant they open this tab. Every
  // other /app page guards the same way.
  const roomsQuery = useQuery({
    queryKey: ['exam-hall', 'rooms'],
    queryFn: () => api.get<RoomRow[]>('/manage/rooms'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const classesQuery = useQuery({
    queryKey: ['exam-hall', 'classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  // Saving wrote a plan nothing could open again, while the toast said "you can
  // reprint it any time". Either the promise goes or the list does.
  const plansQuery = useQuery({
    queryKey: ['exam-hall', 'plans'],
    queryFn: () => api.get<SeatingPlanSummary[]>('/manage/seating'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const rooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data]);
  const classes = useMemo(
    () => (classesQuery.data ?? []).filter((c) => c._count.students > 0),
    [classesQuery.data],
  );

  /**
   * Land on the school's first room rather than an empty editor. Runs only
   * while nothing is selected, so it never yanks the office off a room it is
   * in the middle of editing.
   */
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || draft.id || dirty || !rooms.length) return;
    picked.current = true;
    loadRoom(rooms[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, draft.id, dirty]);

  function loadRoom(r: RoomRow) {
    setDraft({
      id: r.id,
      name: r.name,
      rows: r.rows,
      cols: r.cols,
      seatsPerDesk: r.seatsPerDesk,
      removedDesks: r.removedDesks,
    });
    setDirty(false);
    setPlan(null);
    setPlanRoom(null);
    setChosen(null);
  }

  function edit(patch: Partial<RoomDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setPlan(null);
    setPlanRoom(null);
  }

  // ── room writes ────────────────────────────────────────────────────────────

  const saveRoom = useMutation({
    mutationFn: async (d: RoomDraft) => {
      const body = {
        name: d.name.trim(),
        rows: d.rows,
        cols: d.cols,
        seatsPerDesk: d.seatsPerDesk,
        // A room shrunk in the editor leaves "row:col" strings pointing past
        // the new grid; a stale one silently removes a desk that IS there.
        removedDesks: d.removedDesks.filter((k) => {
          const [r, c] = k.split(':').map(Number);
          return r < d.rows && c < d.cols;
        }),
      };
      return d.id
        ? api.put<RoomRow>(`/manage/rooms/${d.id}`, body)
        : api.post<RoomRow>('/manage/rooms', body);
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['exam-hall', 'rooms'] });
      setDraft({ ...draft, id: row.id, removedDesks: row.removedDesks });
      setDirty(false);
    },
    onError: (e) => toast.error(errText(e)),
  });

  const duplicateRoom = useMutation({
    mutationFn: (id: string) => api.post<RoomRow>(`/manage/rooms/${id}/duplicate`, {}),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['exam-hall', 'rooms'] });
      loadRoom(row);
      toast.success(`Copied to “${row.name}”. Rename it and you're done.`);
    },
    onError: (e) => toast.error(errText(e)),
  });

  const deleteRoom = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/rooms/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-hall', 'rooms'] });
      setDraft(NEW_ROOM);
      setDirty(false);
      setPlan(null);
    },
    onError: (e) => toast.error(errText(e)),
  });

  // ── seating ────────────────────────────────────────────────────────────────

  const makeSeating = useMutation({
    mutationFn: (seed: number) =>
      api.post<SeatingPlanResult>('/manage/seating/preview', {
        roomId: draft.id,
        classSectionIds: ticked,
        title: title.trim() || 'Exam seating',
        rules,
        seed,
      }),
    onSuccess: (p) => {
      setPlan(p);
      setPlanRoom({
        rows: draft.rows,
        cols: draft.cols,
        seatsPerDesk: draft.seatsPerDesk,
        removedDesks: draft.removedDesks,
      });
      setChosen(null);
    },
    onError: (e) => toast.error(errText(e)),
  });

  /**
   * Reopening a saved plan restores the room AS IT WAS SAVED, not as the room
   * is now — a chart already printed and pasted onto desks must not silently
   * redraw itself.
   */
  const openPlan = useMutation({
    mutationFn: (id: string) => api.get<SavedSeatingPlan>(`/manage/seating/${id}`),
    onSuccess: (p) => {
      // The editor follows the room as it is TODAY; the chart follows the room
      // as it was when the plan was saved. Collapsing the two would let a
      // reprint quietly rewrite the room.
      const live = rooms.find((r) => r.id === p.roomId);
      setDraft(
        live
          ? {
              id: live.id,
              name: live.name,
              rows: live.rows,
              cols: live.cols,
              seatsPerDesk: live.seatsPerDesk,
              removedDesks: live.removedDesks,
            }
          : { id: p.roomId, name: p.roomName, ...p.room },
      );
      setPlanRoom(p.room);
      setDirty(false);
      setTicked(p.classSectionIds);
      setRules(p.rules);
      setTitle(p.title);
      setPlan(p);
      setChosen(null);
      setStep(1);
    },
    onError: (e) => toast.error(errText(e)),
  });

  const deletePlan = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/seating/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exam-hall', 'plans'] }),
    onError: (e) => toast.error(errText(e)),
  });

  const savePlan = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/manage/seating', {
        roomId: draft.id,
        classSectionIds: ticked,
        title: title.trim() || 'Exam seating',
        rules,
        seed: plan?.seed,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-hall', 'plans'] });
      toast.success('Seating saved. It is in “Saved seatings” whenever you need to reprint.');
    },
    onError: (e) => toast.error(errText(e)),
  });

  /**
   * The seed is what makes a reprint the same hall, so it must never come from
   * the render body — a `Math.random()` there disagrees between the server
   * render and hydration. It is read only inside a click handler.
   */
  const seedRef = useRef(11);
  function generate(reshuffle: boolean) {
    if (!draft.id) {
      toast.error('Save the room first.');
      return;
    }
    if (!ticked.length) {
      toast.error('Tick at least one class.');
      return;
    }
    if (reshuffle) seedRef.current = ((seedRef.current * 37 + 13) % 9971) + 1;
    makeSeating.mutate(seedRef.current);
  }

  /** Saving the room before generating is one less decision for the office. */
  async function goToSeating() {
    if (!draft.name.trim()) {
      toast.error('Give the room a name first.');
      return;
    }
    if (dirty || !draft.id) {
      try {
        await saveRoom.mutateAsync(draft);
      } catch {
        return;
      }
    }
    setStep(1);
  }

  // ── print ──────────────────────────────────────────────────────────────────

  /**
   * The sheets live in a hidden container on this page rather than a second
   * route, so nothing is re-fetched and what prints is exactly what was on
   * screen. `eh-printing` is set only for the length of the print, so a stray
   * Cmd+P still prints the console a person is actually looking at.
   */
  function printSheet() {
    document.body.classList.add('eh-printing');
    const done = () => {
      document.body.classList.remove('eh-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    // Safari never fires afterprint from a cancelled dialog.
    window.setTimeout(done, 60_000);
  }

  // ── derived ────────────────────────────────────────────────────────────────

  const capacity = capacityOf(draft, rules.backRowFree);
  const tickedCount = classes
    .filter((c) => ticked.includes(c.id))
    .reduce((n, c) => n + c._count.students, 0);

  const seatAt = useMemo(() => {
    const m = new Map<string, PlannedSeat>();
    for (const s of plan?.seats ?? []) m.set(`${s.row}:${s.seat}`, s);
    return m;
  }, [plan]);

  const clashAt = useMemo(
    () => clashesIn(plan?.seats ?? [], rules, plan?.classSectionIds.length ?? 0),
    [plan, rules],
  );

  /** Class order decides the tone, so the key, the seat and the slip agree. */
  const classOrder = plan ? plan.classSectionIds : ticked;
  const tone = (id: string) => toneFor(classOrder, id);

  const chosenSeat = chosen ? seatAt.get(chosen) : undefined;
  const saved = plansQuery.data ?? [];
  /** Step 2 and step 3 draw on the plan's own floor, never the editor's. */
  const chartRoom: RoomShape = planRoom ?? draft;
  const roomMoved =
    planRoom !== null &&
    (planRoom.rows !== draft.rows ||
      planRoom.cols !== draft.cols ||
      planRoom.seatsPerDesk !== draft.seatsPerDesk ||
      planRoom.removedDesks.length !== draft.removedDesks.length);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <header className="sk-pagehead sk-wrap-sm" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>Exam Hall</h1>
          <p>Draw the room once, tick the classes, print. Nothing in the hall needs a phone.</p>
        </div>
      </header>

      {!host || classesQuery.isLoading || roomsQuery.isLoading ? (
        <p className="sk-state">Loading…</p>
      ) : null}
      {roomsQuery.error ? <p className="sk-state err">{errText(roomsQuery.error)}</p> : null}
      {classesQuery.error ? <p className="sk-state err">{errText(classesQuery.error)}</p> : null}

      <div className="sk-card" style={{ overflow: 'hidden' }}>
        <div className="sk-eh-steps" role="tablist">
          {['Your room', 'The seating', 'What prints'].map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={step === i}
              onClick={() => setStep(i)}
              disabled={i > 0 && !draft.id}
            >
              <span className="n">{i + 1}</span>
              {label}
            </button>
          ))}
        </div>

        {/* ── STEP 1 · the room ────────────────────────────────────────────── */}
        {step === 0 ? (
          <div className="sk-eh-pane">
            <div className="sk-eh-side">
              <div className="sk-eh-group">
                <span className="sk-lab">Your rooms</span>
                {rooms.length === 0 ? (
                  <p className="sk-state" style={{ padding: 0 }}>
                    No rooms yet. Give the first one a name and a shape.
                  </p>
                ) : null}
                <div className="sk-eh-rooms">
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="sk-eh-room sk-press"
                      aria-pressed={draft.id === r.id}
                      onClick={() => loadRoom(r)}
                    >
                      <span className="nm">{r.name}</span>
                      <span className="meta">
                        {r.rows} × {r.cols} · {r.capacity} seats
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="sk-btn sk-press"
                  onClick={() => {
                    setDraft(NEW_ROOM);
                    setDirty(false);
                    setPlan(null);
                  }}
                >
                  <Plus size={14} /> Add a room
                </button>
              </div>

              <div className="sk-eh-group">
                <span className="sk-lab">This room</span>
                <label className="sk-lab" htmlFor="eh-name" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  Room name
                </label>
                <input
                  id="eh-name"
                  className="sk-input"
                  value={draft.name}
                  placeholder="Hall A"
                  onChange={(e) => edit({ name: e.target.value })}
                />
                <div className="sk-wrap-sm" style={{ display: 'flex', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label className="sk-lab" htmlFor="eh-rows" style={{ textTransform: 'none', letterSpacing: 0 }}>
                      Rows
                    </label>
                    <input
                      id="eh-rows"
                      className="sk-input"
                      type="number"
                      min={1}
                      max={20}
                      style={{ width: 80 }}
                      value={draft.rows}
                      onChange={(e) => edit({ rows: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label className="sk-lab" htmlFor="eh-cols" style={{ textTransform: 'none', letterSpacing: 0 }}>
                      Desks in a row
                    </label>
                    <input
                      id="eh-cols"
                      className="sk-input"
                      type="number"
                      min={1}
                      max={30}
                      style={{ width: 80 }}
                      value={draft.cols}
                      onChange={(e) => edit({ cols: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                    />
                  </div>
                </div>
              </div>

              <div className="sk-eh-group">
                <span className="sk-lab">Students on one desk</span>
                <div className="sk-seg">
                  {[1, 2].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={draft.seatsPerDesk === n}
                      onClick={() => edit({ seatsPerDesk: n })}
                    >
                      {n === 1 ? 'One' : 'Two'}
                    </button>
                  ))}
                </div>
                <p className="sk-muted">
                  Two only if the desk is a bench. The two students on it will always be from different
                  classes.
                </p>
              </div>

              <div className="sk-eh-group">
                <span className="sk-lab">Missing desks</span>
                <p className="sk-muted">
                  <strong>Click any desk on the right</strong> to take it out — a pillar, a broken desk, or a
                  gap you keep as a walking lane. Click it again to put it back.
                </p>
                {draft.removedDesks.length > 0 ? (
                  <button type="button" className="sk-btn sk-press" onClick={() => edit({ removedDesks: [] })}>
                    Put {draft.removedDesks.length} desk{draft.removedDesks.length === 1 ? '' : 's'} back
                  </button>
                ) : null}
              </div>

              <div className="sk-kpi" data-tone={capacity >= 1 ? 'good' : 'bad'}>
                <span className="lab">Seats you can use</span>
                <span className="n sk-num">{capacity}</span>
                <span className="hint">
                  {deskCount(draft)} desks
                  {draft.seatsPerDesk === 2 ? ', two to a desk' : ''}
                  {rules.backRowFree && draft.rows > 1 ? ', back row kept spare' : ''}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="sk-btn sk-press"
                  data-variant={dirty || !draft.id ? 'primary' : undefined}
                  disabled={saveRoom.isPending || !draft.name.trim()}
                  onClick={() => saveRoom.mutate(draft)}
                >
                  {saveRoom.isPending ? 'Saving…' : draft.id ? 'Save changes' : 'Save room'}
                </button>
                {draft.id ? (
                  <>
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      title="Make another room the same shape"
                      disabled={duplicateRoom.isPending}
                      onClick={() => duplicateRoom.mutate(draft.id!)}
                    >
                      <Copy size={14} /> Copy
                    </button>
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      aria-label={`Delete ${draft.name || 'this room'}`}
                      title={`Delete ${draft.name || 'this room'}`}
                      disabled={deleteRoom.isPending}
                      onClick={() => {
                        // A room is ten minutes of somebody's afternoon and there
                        // is no undo, so the icon alone must not be enough.
                        if (window.confirm(`Delete ${draft.name || 'this room'}? This cannot be undone.`)) {
                          deleteRoom.mutate(draft.id!);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="sk-eh-main">
              <div className="sk-eh-board" aria-hidden="true" />
              <div className="sk-eh-boardcap">Blackboard · teacher&rsquo;s table</div>
              <RoomGrid
                room={draft}
                backRowFree={rules.backRowFree}
                onToggleDesk={(row, desk) => {
                  const k = deskKey(row, desk);
                  const has = draft.removedDesks.includes(k);
                  edit({
                    removedDesks: has
                      ? draft.removedDesks.filter((x) => x !== k)
                      : [...draft.removedDesks, k],
                  });
                }}
              />
              <p className="sk-muted" style={{ marginTop: 14 }}>
                The back row is kept empty so the teacher can stand behind everyone. That is the only rule
                this screen applies.
              </p>
              <div className="sk-wrap-sm" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                <button
                  type="button"
                  className="sk-btn sk-press"
                  data-variant="primary"
                  disabled={saveRoom.isPending}
                  onClick={goToSeating}
                >
                  Next: the seating →
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── STEP 2 · the seating ─────────────────────────────────────────── */}
        {step === 1 ? (
          <div className="sk-eh-pane">
            <div className="sk-eh-side">
              <div className="sk-eh-group">
                <span className="sk-lab">Which exam is this</span>
                <input
                  className="sk-input"
                  value={title}
                  placeholder="Half-Yearly, Day 3"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="sk-eh-group">
                <span className="sk-lab">Classes in this room</span>
                {classes.length === 0 ? (
                  <p className="sk-state" style={{ padding: 0 }}>
                    No class has students yet. Add students first.
                  </p>
                ) : null}
                {classes.map((c) => {
                  const on = ticked.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="sk-eh-tick"
                      aria-pressed={on}
                      onClick={() => {
                        setTicked((t) => (on ? t.filter((x) => x !== c.id) : [...t, c.id]));
                        setPlan(null);
                      }}
                    >
                      <span className="box" aria-hidden="true" />
                      {on ? <span className="swatch" data-tone={tone(c.id)} aria-hidden="true" /> : null}
                      <span>
                        <span className="lbl">
                          {c.grade.name}-{c.name}
                        </span>
                      </span>
                      <span className="cnt">{c._count.students}</span>
                    </button>
                  );
                })}
                <p className="sk-muted">
                  Read from your school. You never type a student&rsquo;s name here.
                </p>
              </div>

              <div className="sk-eh-group">
                <span className="sk-lab">Rules</span>
                {RULE_TEXT.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className="sk-eh-tick"
                    aria-pressed={rules[r.key]}
                    onClick={() => {
                      setRules((x) => ({ ...x, [r.key]: !x[r.key] }));
                      setPlan(null);
                    }}
                  >
                    <span className="box" aria-hidden="true" />
                    <span>
                      <span className="lbl">{r.label}</span>
                      <span className="sub">{r.sub}</span>
                    </span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="sk-btn sk-press"
                data-variant="primary"
                style={{ width: '100%' }}
                disabled={makeSeating.isPending || !ticked.length}
                onClick={() => generate(false)}
              >
                {makeSeating.isPending ? 'Working…' : 'Make the seating'}
              </button>
              {plan ? (
                <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    style={{ flex: 1 }}
                    disabled={makeSeating.isPending}
                    onClick={() => generate(true)}
                    title="A new arrangement, in case the chart leaked"
                  >
                    Reshuffle
                  </button>
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    style={{ flex: 1 }}
                    disabled={savePlan.isPending}
                    onClick={() => savePlan.mutate()}
                  >
                    {savePlan.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="sk-eh-main">
              <div className="sk-eh-board" aria-hidden="true" />
              <div className="sk-eh-boardcap">Blackboard · teacher&rsquo;s table</div>

              <RoomGrid
                room={chartRoom}
                backRowFree={rules.backRowFree}
                seats={plan?.seats}
                classOrder={classOrder}
                clashes={clashAt}
                chosen={chosen}
                onPickSeat={(k) => setChosen(k)}
              />

              {plan ? (
                <>
                  <div className="sk-eh-key">
                    {plan.classSectionIds.map((id) => {
                      const c = classes.find((x) => x.id === id);
                      if (!c) return null;
                      return (
                        <span key={id}>
                          <i data-tone={tone(id)} />
                          {c.grade.name}-{c.name} · {c._count.students}
                        </span>
                      );
                    })}
                    <span>Click a seat to ask why</span>
                  </div>

                  <div
                    className="sk-kpi sk-eh-result"
                    data-tone={plan.report.clashes === 0 ? 'good' : 'bad'}
                    style={{ marginTop: 14 }}
                  >
                    <span className="lab">Rules broken</span>
                    <span className="n sk-num">{plan.report.clashes}</span>
                    <span className="hint">{plan.report.notes.join(' ')}</span>
                  </div>

                  {roomMoved ? (
                    <p className="sk-state" data-testid="room-moved" style={{ marginTop: 12 }}>
                      {draft.name} has changed shape since this seating was saved. The chart below is
                      the room as it was, so a reprint matches the stickers already on the desks.
                    </p>
                  ) : null}
                  <div className="sk-eh-why">
                    {chosenSeat ? (
                      <>
                        <b>{chosenSeat.studentName}</b> — {chosenSeat.classLabel}
                        {chosenSeat.roll !== null ? `, roll ${chosenSeat.roll}` : ''}, row{' '}
                        {chosenSeat.row + 1} seat {chosenSeat.seat + 1}.{' '}
                        {describeNeighbours(chosenSeat, plan.seats)}
                      </>
                    ) : (
                      'Click any seat and it tells you, in one sentence, why that student is there.'
                    )}
                  </div>

                  <div className="sk-wrap-sm" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      data-variant="primary"
                      onClick={() => setStep(2)}
                    >
                      Next: what prints →
                    </button>
                  </div>
                </>
              ) : (
                <p className="sk-state" style={{ marginTop: 16 }}>
                  {ticked.length
                    ? `${tickedCount} students ticked, ${capacity} seats in ${draft.name || 'this room'}. Press “Make the seating”.`
                    : 'Tick the classes that sit in this room, then press “Make the seating”.'}
                </p>
              )}
            </div>
          </div>
        ) : null}

        {/* ── STEP 3 · what prints ─────────────────────────────────────────── */}
        {step === 2 ? (
          <div className="sk-eh-pane">
            <div className="sk-eh-side">
              <span className="sk-lab">Goes to the printer</span>
              {SHEETS.map((s) => {
                const on = sheets.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="sk-eh-tick"
                    aria-pressed={on}
                    onClick={() =>
                      setSheets((cur) =>
                        on ? cur.filter((k) => k !== s.key) : [...cur, s.key],
                      )
                    }
                  >
                    <span className="box" aria-hidden="true" />
                    <span>
                      <span className="lbl">{s.label}</span>
                      <span className="sub">{s.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="sk-eh-main">
              {saved.length ? (
                <div className="sk-eh-group" style={{ marginBottom: 18 }}>
                  <span className="sk-lab">Saved seatings</span>
                  {saved.map((p) => (
                    <div className="sk-eh-saved" key={p.id}>
                      <button
                        type="button"
                        className="open"
                        disabled={openPlan.isPending}
                        onClick={() => openPlan.mutate(p.id)}
                      >
                        <span className="nm">{p.title}</span>
                        <span className="meta">
                          {p.roomName} · {p.seated} students ·{' '}
                          {new Date(p.createdAt).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="sk-btn sk-press"
                        aria-label={`Delete the saved seating “${p.title}”`}
                        title={`Delete “${p.title}”`}
                        disabled={deletePlan.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete the saved seating “${p.title}”? This cannot be undone.`)) {
                            deletePlan.mutate(p.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <p className="sk-muted">
                    Opening one restores the room exactly as it was when you saved it.
                  </p>
                </div>
              ) : null}

              {plan ? (
                <>
                  <p className="sk-muted" style={{ marginBottom: 14 }}>
                    Sheets are A4 at true size. Set the print dialog to <strong>100% / Actual size</strong>,
                    not “Fit”. Desk stickers are 21 to a sheet (Avery L7160) and student slips are 12
                    (L7164); plain gummed A4 works too.
                  </p>
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    data-variant="primary"
                    disabled={!sheets.length}
                    onClick={printSheet}
                  >
                    <Printer size={14} />{' '}
                    {sheets.length === 1
                      ? `Print ${SHEETS.find((s) => s.key === sheets[0])?.label.toLowerCase()}`
                      : `Print ${sheets.length} sheets`}
                  </button>
                  <div className="sk-eh-why" style={{ marginTop: 16 }}>
                    <b>{plan.roomName}</b> — {plan.title}. {plan.report.seated} students,{' '}
                    {plan.report.clashes === 0 ? 'no rule broken' : `${plan.report.clashes} rules broken`}.
                    {plan.report.unseated > 0
                      ? ` ${plan.report.unseated} still need another room.`
                      : ''}
                  </div>
                  <SheetPreview
                    plan={plan}
                    room={chartRoom}
                    school={host ?? ''}
                    sheets={sheets}
                  />
                </>
              ) : (
                <p className="sk-state">Make the seating first — step 2.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {plan ? (
        <PrintSheets
          plan={plan}
          room={chartRoom}
          school={host ?? ''}
          sheets={sheets}
        />
      ) : null}
    </div>
  );
}
