'use client';
import type { PlannedSeat, SavedSeatingPlan, SeatingPlanResult } from '@skoolos/types';

/**
 * Everything the exam actually runs on.
 *
 * Teachers do not carry phones into a hall, so the paper IS the product. These
 * sheets render into a container the print stylesheet is the only thing that
 * shows (`app/app/exam-hall/print.css`), which is why they carry their own
 * literal ink colours and millimetre geometry rather than the theme tokens: a
 * sheet is paper in both themes, and a chart that came out of a dark-mode
 * browser as white-on-black would waste a cartridge.
 */

export type Sheet = 'chart' | 'door' | 'attendance' | 'stickers' | 'slips';

export const SHEETS: { key: Sheet; label: string; blurb: string }[] = [
  { key: 'chart', label: 'Seating chart', blurb: "One A4 for the teacher's table. Names in the shape of the room." },
  { key: 'door', label: 'Door list', blurb: 'Roll numbers for the corridor, so students find the room.' },
  { key: 'attendance', label: 'Attendance sheet', blurb: 'A signature column, and the count already printed on it.' },
  { key: 'stickers', label: 'Desk stickers', blurb: '21 to an A4 sheet. Printed once, pasted once.' },
  { key: 'slips', label: 'Student slips', blurb: '12 to an A4 sheet. One per student per paper.' },
];

type Plan = SeatingPlanResult | SavedSeatingPlan;

interface RoomShape {
  rows: number;
  cols: number;
  seatsPerDesk: number;
  removedDesks: string[];
}

/** The four class tones, as PRINT ink — a laser has no CSS variables. */
const INK = ['#4f46e5', '#178a5b', '#c4453f', '#a16207'];

function toneOf(plan: Plan, classSectionId: string): string {
  const i = plan.classSectionIds.indexOf(classSectionId);
  return INK[(i < 0 ? 0 : i) % INK.length];
}

function bySeat(plan: Plan): Map<string, PlannedSeat> {
  return new Map(plan.seats.map((s) => [`${s.row}:${s.seat}`, s]));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function seatCode(row: number, seat: number): string {
  return `R${row + 1}·S${pad2(seat + 1)}`;
}

/** A4 page. Everything inside is positioned in mm so the print is true size. */
function Page({ children }: { children: React.ReactNode }) {
  return <div className="eh-page">{children}</div>;
}

function SheetHead({ plan, note }: { plan: Plan; note: string }) {
  return (
    <div className="eh-head">
      <div>
        <div className="eh-room">{plan.roomName}</div>
        <div className="eh-title">{plan.title}</div>
      </div>
      <div className="eh-note">{note}</div>
    </div>
  );
}

// ── 1. Seating chart ─────────────────────────────────────────────────────────

function Chart({ plan, room }: { plan: Plan; room: RoomShape }) {
  const at = bySeat(plan);
  const gone = new Set(room.removedDesks);
  return (
    <Page>
      <SheetHead plan={plan} note={`${plan.report.seated} students · chart for the teacher's table`} />
      <div className="eh-board" />
      <div className="eh-boardcap">Blackboard · teacher&rsquo;s table</div>
      <div className="eh-chart">
        {Array.from({ length: room.rows }, (_, row) => (
          <div className="eh-crow" key={row}>
            <span className="eh-rowno">{row + 1}</span>
            {Array.from({ length: room.cols }, (_, desk) => (
              <div className="eh-cdesk" key={desk}>
                {Array.from({ length: room.seatsPerDesk }, (_, s) => {
                  const seat = desk * room.seatsPerDesk + s;
                  const who = at.get(`${row}:${seat}`);
                  if (gone.has(`${row}:${desk}`)) {
                    return <div className="eh-ccell eh-gone" key={s} />;
                  }
                  if (!who) return <div className="eh-ccell eh-empty" key={s} />;
                  return (
                    <div className="eh-ccell" key={s} style={{ borderLeft: `1.4mm solid ${toneOf(plan, who.classSectionId)}` }}>
                      <span className="eh-cseat">{seatCode(row, seat)}</span>
                      <span className="eh-cname">{who.studentName}</span>
                      <span className="eh-cclass">
                        {who.classLabel}
                        {who.roll !== null ? ` · ${who.roll}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Page>
  );
}

// ── 2. Door list ─────────────────────────────────────────────────────────────

/**
 * What goes on the corridor wall. Grouped by class and sorted by roll, because
 * a student arriving looks for their own class first and their own number
 * second — never for a seat code they have not been told yet.
 */
function DoorList({ plan }: { plan: Plan }) {
  const groups = new Map<string, PlannedSeat[]>();
  for (const s of plan.seats) {
    groups.set(s.classLabel, [...(groups.get(s.classLabel) ?? []), s]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.roll ?? 9999) - (b.roll ?? 9999) || a.studentName.localeCompare(b.studentName));
  }

  return (
    <Page>
      <SheetHead plan={plan} note={`${plan.report.seated} students · put this on the door`} />
      <div className="eh-doorgrid">
        {[...groups.entries()].map(([label, list]) => (
          <div className="eh-doorcol" key={label}>
            <div className="eh-doorclass">
              {label} <span>{list.length}</span>
            </div>
            {list.map((s) => (
              <div className="eh-doorrow" key={s.studentId}>
                <span className="eh-roll">{s.roll ?? '—'}</span>
                <span className="eh-dname">{s.studentName}</span>
                <span className="eh-dseat">{s.code}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Page>
  );
}

// ── 3. Attendance sheet ──────────────────────────────────────────────────────

/**
 * The sheet that comes back to the office at ten o'clock. It carries the count
 * already printed, so a mismatch is visible in the hall while it can still be
 * fixed rather than in the office when it cannot.
 */
function Attendance({ plan }: { plan: Plan }) {
  const rows = [...plan.seats].sort((a, b) => a.row - b.row || a.seat - b.seat);
  const perPage = 32;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));

  return (
    <>
      {Array.from({ length: pages }, (_, p) => (
        <Page key={p}>
          <SheetHead
            plan={plan}
            note={`Sheet ${p + 1} of ${pages} · ${plan.report.seated} students expected`}
          />
          <table className="eh-att">
            <thead>
              <tr>
                <th className="w-seat">Seat</th>
                <th>Name</th>
                <th className="w-class">Class</th>
                <th className="w-roll">Roll</th>
                <th className="w-sign">Signature</th>
                <th className="w-abs">Absent</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(p * perPage, (p + 1) * perPage).map((s) => (
                <tr key={s.studentId}>
                  <td className="eh-mono">{s.code}</td>
                  <td>{s.studentName}</td>
                  <td>{s.classLabel}</td>
                  <td className="eh-mono">{s.roll ?? '—'}</td>
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {p === pages - 1 ? (
            <div className="eh-sign">
              <span>Present ______</span>
              <span>Absent ______</span>
              <span>Sheets issued ______</span>
              <span>Invigilator ____________________</span>
            </div>
          ) : null}
        </Page>
      ))}
    </>
  );
}

// ── 4. Desk stickers (21 per A4, Avery L7160) ────────────────────────────────

/**
 * The PERMANENT sticker. It names the SEAT and carries no child's name, no
 * class and no code that resolves to one: a desk stands in a room anyone can
 * walk through, and it should not tell them who sits there. It also outlives
 * the sitting — seating rotates, desks do not — which is why it is printed once
 * for every desk in the room, including the spare back row.
 */
function Stickers({ plan, room, school }: { plan: Plan; room: RoomShape; school: string }) {
  const gone = new Set(room.removedDesks);
  const labels: { code: string }[] = [];
  for (let row = 0; row < room.rows; row++) {
    for (let seat = 0; seat < room.cols * room.seatsPerDesk; seat++) {
      const desk = Math.floor(seat / room.seatsPerDesk);
      if (!gone.has(`${row}:${desk}`)) labels.push({ code: seatCode(row, seat) });
    }
  }

  const per = 21;
  const pages = Math.max(1, Math.ceil(labels.length / per));
  return (
    <>
      {Array.from({ length: pages }, (_, p) => (
        <div className="eh-page eh-sheet-21" key={p}>
          {labels.slice(p * per, (p + 1) * per).map((l, i) => (
            <div className="eh-lab eh-lab-seat" key={i}>
              <span className="t">{plan.roomName}</span>
              <span className="c">{l.code}</span>
              <span className="f">{school}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ── 5. Student slips (12 per A4, Avery L7164) ────────────────────────────────

/** The per-paper slip. This one carries the child, and it comes off afterwards. */
function Slips({ plan, school }: { plan: Plan; school: string }) {
  const rows = [...plan.seats].sort((a, b) => a.row - b.row || a.seat - b.seat);
  const per = 12;
  const pages = Math.max(1, Math.ceil(rows.length / per));
  return (
    <>
      {Array.from({ length: pages }, (_, p) => (
        <div className="eh-page eh-sheet-12" key={p}>
          {rows.slice(p * per, (p + 1) * per).map((s) => (
            <div className="eh-lab eh-lab-slip" key={s.studentId}>
              <span className="tint" style={{ background: toneOf(plan, s.classSectionId) }} />
              <span className="in">
                <span className="r1">
                  <span>
                    {s.classLabel}
                    {s.roll !== null ? ` · Roll ${s.roll}` : ''}
                  </span>
                  <span>{school}</span>
                </span>
                <span className="nm">{s.studentName}</span>
                <span className="r3">
                  <span>{plan.title}</span>
                  <b>
                    {plan.roomName} · {s.code}
                  </b>
                </span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ── the container the print stylesheet shows ─────────────────────────────────

function OneSheet({
  sheet,
  plan,
  room,
  school,
}: {
  sheet: Sheet;
  plan: Plan;
  room: RoomShape;
  school: string;
}) {
  if (sheet === 'chart') return <Chart plan={plan} room={room} />;
  if (sheet === 'door') return <DoorList plan={plan} />;
  if (sheet === 'attendance') return <Attendance plan={plan} />;
  if (sheet === 'stickers') return <Stickers plan={plan} room={room} school={school} />;
  return <Slips plan={plan} school={school} />;
}

/**
 * Every ticked sheet, in one print job.
 *
 * The office does not want a seating chart; it wants the bundle — chart, door
 * list, attendance sheet, stickers, slips — sorted and stapled. Printing them
 * one at a time is five trips to the dialog, so `sheets` is a list and the
 * order here is the order they come off the printer.
 */
export function PrintSheets({
  plan,
  room,
  school,
  sheets,
}: {
  plan: Plan;
  room: RoomShape;
  school: string;
  sheets: Sheet[];
}) {
  const ordered = SHEETS.filter((s) => sheets.includes(s.key));
  return (
    <div id="eh-print" className="eh-sheets" aria-hidden="true">
      {ordered.map((s) => (
        <OneSheet key={s.key} sheet={s.key} plan={plan} room={room} school={school} />
      ))}
    </div>
  );
}

/**
 * The same sheets, on screen, shrunk to fit beside the picker.
 *
 * Without this the office ticks five boxes and prints on faith. It renders the
 * identical component tree as the print container, so what is previewed cannot
 * drift from what comes out.
 */
export function SheetPreview({
  plan,
  room,
  school,
  sheets,
}: {
  plan: Plan;
  room: RoomShape;
  school: string;
  sheets: Sheet[];
}) {
  const ordered = SHEETS.filter((s) => sheets.includes(s.key));
  if (!ordered.length) return null;
  return (
    <div className="sk-eh-preview">
      {ordered.map((s) => (
        <figure key={s.key}>
          <figcaption>{s.label}</figcaption>
          <div className="sk-eh-paper">
            <div className="sk-eh-paper-in eh-sheets">
              <OneSheet sheet={s.key} plan={plan} room={room} school={school} />
            </div>
          </div>
        </figure>
      ))}
    </div>
  );
}
