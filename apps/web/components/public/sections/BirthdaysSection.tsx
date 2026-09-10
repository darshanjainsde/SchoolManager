'use client';
import type { BirthdayRow, BirthdaysResult } from '@/lib/public-api';
import type { CelebrationsPage } from '../celebrations-config';
import { fillWish } from '../celebrations-config';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Coin tints: the school's own brand first, then three constant accents. The
 * coin is what a child with no photo (or no consent) gets, so every school
 * looks finished with zero photos.
 */
const COIN_TINTS = ['var(--ps1)', '#F59E0B', '#EC4899', '#0EA5E9'];

/*
 * Every position below is a CONSTANT. Math.random()/Date in render desyncs the
 * server HTML from the hydration pass — that trap is already in the ledger, so
 * the "randomness" is hand-rolled tables instead (same rule as FestiveLayer).
 */
const CONF_LEFT = [6, 14, 23, 35, 47, 58, 69, 80, 91, 40];
const CONF_DELAY = [0, 1.1, 2.3, 0.6, 3.4, 1.8, 4.2, 2.9, 5.1, 5.8];
const CARD_TILT = [-2, 1.5, 2, -1, 1, -1.5, 2.5, -2.5];
const PIN_TINTS = ['#DC2626', '#2563EB', '#16A34A', '#F59E0B'];

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function Coin({ row, i, size }: { row: BirthdayRow; i: number; size: number }) {
  if (row.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- operator-supplied photo, sized by the coin
    return <img src={row.photoUrl} alt="" width={size} height={size} className="ps-bd-coin ps-bd-coin-photo" style={{ width: size, height: size }} />;
  }
  return (
    <span className="ps-bd-coin" style={{ width: size, height: size, background: COIN_TINTS[i % COIN_TINTS.length], fontSize: Math.round(size * 0.32) }} aria-hidden="true">
      {initialsOf(row.name)}
    </span>
  );
}

function dateLabel(row: BirthdayRow): string {
  return `${row.day} ${MONTHS[row.month - 1]}`;
}

/** "Wednesday, 9 September" from the API's YYYY-MM-DD — no client clock involved. */
function longDate(generatedFor: string): string {
  const [y, m, d] = generatedFor.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getUTCDay()];
  return `${dow}, ${d} ${MONTHS_LONG[m - 1]}`;
}

interface Props {
  data: BirthdaysResult;
  style: CelebrationsPage;
  wishLine: string;
  schoolName: string;
  onOwnPage?: boolean;
}

/**
 * The birthday wall (Active Roster, Track B). Same rows, three rooms: a party
 * wall, a month planner, a notice board. Every look shows today first, then
 * the coming days, and falls back to an initials coin for a child without a
 * photo. Rows carry day and month only — there is no year anywhere in here.
 */
export default function BirthdaysSection({ data, style, wishLine, schoolName, onOwnPage = false }: Props) {
  const nextLine = data.today.length === 0 && data.next ? `Next: ${data.next.name}, ${dateLabel(data.next)}` : null;
  const styleCls = style === 'PARTY_WALL' ? 'ps-bd-party' : style === 'MONTH_PLANNER' ? 'ps-bd-planner' : 'ps-bd-board';
  return (
    <section
      id="birthdays"
      data-sec="birthdays"
      className={`ps-bd ${styleCls} ${onOwnPage ? 'ps-bd-page' : ''} max-w-6xl mx-auto px-6 ${onOwnPage ? 'pt-10 pb-20' : 'py-16'}`}
      aria-labelledby="ps-bd-title"
    >
      {style === 'PARTY_WALL' && <PartyWall data={data} wishLine={wishLine} schoolName={schoolName} nextLine={nextLine} />}
      {style === 'MONTH_PLANNER' && <MonthPlanner data={data} nextLine={nextLine} />}
      {style === 'NOTICE_BOARD' && <NoticeBoard data={data} nextLine={nextLine} />}
    </section>
  );
}

function PartyWall({ data, wishLine, schoolName, nextLine }: { data: BirthdaysResult; wishLine: string; schoolName: string; nextLine: string | null }) {
  const n = data.today.length;
  return (
    <div className="ps-panel ps-bd-party-panel">
      {CONF_LEFT.map((left, i) => (
        <span key={i} className="ps-bd-conf" style={{ left: `${left}%`, animationDelay: `${CONF_DELAY[i]}s`, background: COIN_TINTS[i % COIN_TINTS.length] }} aria-hidden="true" />
      ))}
      <p className="ps-eyebrow ps-bd-kicker">{longDate(data.generatedFor)}</p>
      <h2 id="ps-bd-title" className="ps-head ps-bd-h">
        {n > 0 ? 'Happy birthday!' : 'Birthdays'}
      </h2>
      <p className="ps-bd-sub">
        {n === 0 ? nextLine ?? 'No birthdays in this window.' : n === 1 ? `One of us is a year older today. From all of us at ${schoolName}.` : `${n} of us are a year older today. From all of us at ${schoolName}.`}
      </p>
      {n > 0 && (
        <ul className="ps-bd-today" aria-label="Today's birthdays">
          {data.today.map((r, i) => (
            <li key={r.key} className="ps-bd-kid">
              <span className="ps-bd-ring" style={{ animationDelay: `${(i % 4) * 0.3}s` }}>
                <Coin row={r} i={i} size={72} />
              </span>
              <b>{r.name}</b>
              {r.classLabel && <small>Class {r.classLabel}</small>}
              <em className="ps-bd-wish">{fillWish(wishLine, firstNameOf(r.name), schoolName)}</em>
            </li>
          ))}
        </ul>
      )}
      {data.upcoming.length > 0 && (
        <>
          <p className="ps-bd-wk">Coming up</p>
          <ul className="ps-bd-week" aria-label="Upcoming birthdays">
            {data.upcoming.map((r, i) => (
              <li key={r.key} className="ps-bd-cell ps-panel-sm">
                <Coin row={r} i={i + 1} size={32} />
                <span>
                  {r.name}
                  <small>
                    {dateLabel(r)}
                    {r.classLabel ? ` · ${r.classLabel}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {n > 0 && nextLine === null && data.upcoming.length === 0 && <p className="ps-bd-next">That is everyone in this window.</p>}
    </div>
  );
}

function MonthPlanner({ data, nextLine }: { data: BirthdaysResult; nextLine: string | null }) {
  const [y, m, d] = data.generatedFor.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const all = [...data.today, ...data.upcoming];
  const byDay = new Map<number, BirthdayRow[]>();
  for (const r of all) {
    if (r.month !== m) continue;
    (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
  }
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div className="ps-panel ps-bd-planner-panel">
      <div className="ps-bd-planner-top">
        <h2 id="ps-bd-title" className="ps-head ps-bd-h ps-bd-mono">
          {MONTHS_LONG[m - 1]} {y}
        </h2>
        <p className="ps-bd-sub">{data.today.length > 0 ? `${data.today.length} today` : nextLine ?? 'No birthdays this month.'}</p>
      </div>
      <div className="ps-bd-planner-lay">
        <div className="ps-bd-month" role="grid" aria-label={`${MONTHS_LONG[m - 1]} birthdays`}>
          {DOW.map((w) => (
            <div key={w} className="ps-bd-dow" role="columnheader">
              {w.toUpperCase()}
            </div>
          ))}
          {/* Weeks are ARIA rows (display: contents keeps the CSS grid intact). */}
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => cells.slice(w * 7, w * 7 + 7)).map((week, w) => (
          <div key={`w${w}`} role="row" style={{ display: 'contents' }}>
          {week.map((day, i) =>
            day === null ? (
              <div key={`b${w}-${i}`} className="ps-bd-day ps-bd-blank" aria-hidden="true" />
            ) : (
              <div key={day} className={`ps-bd-day${day === d ? ' ps-bd-today-cell' : ''}`} role="gridcell" aria-label={`${day} ${MONTHS[m - 1]}${byDay.has(day) ? `, ${byDay.get(day)!.length} ${byDay.get(day)!.length === 1 ? 'birthday' : 'birthdays'}` : ''}`}>
                <span className="ps-bd-mono">{day}</span>
                {byDay.has(day) && (
                  <span className="ps-bd-dots">
                    {byDay.get(day)!.map((r, j) => (
                      <i key={r.key} style={{ background: COIN_TINTS[j % COIN_TINTS.length] }} title={r.name} />
                    ))}
                  </span>
                )}
              </div>
            ),
          )}
          </div>
          ))}
        </div>
        <div className="ps-bd-list">
          <h3 className="ps-bd-mono ps-bd-list-h">Today · {DOW[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]} {d}</h3>
          {data.today.length === 0 && <p className="ps-bd-sub">Nobody today.</p>}
          {data.today.map((r) => (
            <div key={r.key} className="ps-bd-it">
              <span className="ps-bd-mono">{r.classLabel ?? '—'}</span>
              <b>{r.name}</b>
            </div>
          ))}
          {data.upcoming.length > 0 && <h3 className="ps-bd-mono ps-bd-list-h ps-bd-list-next">Next</h3>}
          {data.upcoming.slice(0, 8).map((r) => (
            <div key={r.key} className="ps-bd-it">
              <span className="ps-bd-mono">{dateLabel(r)}</span>
              <b>
                {r.name}
                {r.classLabel && <small>{r.classLabel}</small>}
              </b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoticeBoard({ data, nextLine }: { data: BirthdaysResult; nextLine: string | null }) {
  const all = [...data.today.map((r) => ({ r, today: true })), ...data.upcoming.map((r) => ({ r, today: false }))];
  return (
    <div className="ps-bd-board-panel">
      <div className="ps-bd-board-edge" aria-hidden="true" />
      <h2 id="ps-bd-title" className="ps-bd-board-title">
        {data.today.length > 0 ? 'Birthdays today' : 'Birthdays this week'}
      </h2>
      {all.length === 0 && <p className="ps-bd-board-empty">{nextLine ?? 'Nothing pinned up yet.'}</p>}
      <ul className="ps-bd-cards" aria-label="Birthday cards">
        {all.map(({ r, today }, i) =>
          r.photoUrl ? (
            <li key={r.key} className="ps-bd-polaroid" style={{ transform: `rotate(${CARD_TILT[i % CARD_TILT.length]}deg)` }}>
              <Coin row={r} i={i} size={120} />
              <span className="ps-bd-cap">
                {r.name}
                {r.classLabel ? ` · ${r.classLabel}` : ''} · {today ? 'today' : dateLabel(r)}
              </span>
            </li>
          ) : (
            <li key={r.key} className={`ps-bd-note${today ? ' ps-bd-note-today' : ''}`} style={{ transform: `rotate(${CARD_TILT[i % CARD_TILT.length]}deg)` }}>
              <span className="ps-bd-pin" style={{ background: `radial-gradient(circle at 35% 35%, #fff 0 15%, ${PIN_TINTS[i % PIN_TINTS.length]} 20%)` }} aria-hidden="true" />
              {today && <Coin row={r} i={i} size={40} />}
              <b>{r.name}</b>
              <small>
                {r.classLabel ? `${r.classLabel} · ` : ''}
                {today ? 'today' : dateLabel(r)}
              </small>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
