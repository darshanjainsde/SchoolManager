/**
 * The rules book's drawings — courts, pitches, the track, the pool, the ring,
 * the target — in true proportion, drawn from metres. Strokes take the console
 * tokens so they read in both schemes. Pure SVG; no fetching.
 */
import type { DiagramKey } from '@skoolos/types';

type Seg = [number, number, number, number];
interface Plan { w: number; h: number; cap: string; segs?: Seg[]; dashed?: Seg[]; circles?: [number, number, number][]; paths?: string[]; labels?: [number, number, string][]; fills?: { d: string; fill: string }[] }

const INK = 'var(--sk-ink-3)';
const LINE = 'var(--sk-line-2)';
const BRAND = 'var(--sk-brand)';

function Court({ p }: { p: Plan }) {
  const m = Math.max(p.w, p.h) * 0.06;
  const fs = Math.max(p.w, p.h) / 34;
  return (
    <div className="sk-sp-diagram">
      <svg viewBox={`${-m} ${-m} ${p.w + 2 * m} ${p.h + 2 * m}`} width={Math.min(560, 40 * p.w)} role="img" aria-label={p.cap}>
        {p.fills?.map((f, i) => <path key={`f${i}`} d={f.d} fill={f.fill} stroke="none" />)}
        <rect x={0} y={0} width={p.w} height={p.h} fill="var(--sk-card)" stroke={INK} strokeWidth={fs / 5} />
        {p.segs?.map((s, i) => <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke={INK} strokeWidth={fs / 6} />)}
        {p.dashed?.map((s, i) => <line key={`d${i}`} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke={LINE} strokeWidth={fs / 6} strokeDasharray={`${fs / 2} ${fs / 2}`} />)}
        {p.circles?.map((c, i) => <circle key={`c${i}`} cx={c[0]} cy={c[1]} r={c[2]} fill="none" stroke={INK} strokeWidth={fs / 6} />)}
        {p.paths?.map((d, i) => <path key={`p${i}`} d={d} fill="none" stroke={INK} strokeWidth={fs / 6} />)}
        {p.labels?.map((l, i) => <text key={`t${i}`} x={l[0]} y={l[1]} fontSize={fs} fill={BRAND} fontFamily="inherit" fontWeight={600} textAnchor="middle">{l[2]}</text>)}
      </svg>
      <span className="cap">{p.cap}</span>
    </div>
  );
}

const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const p = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

const PLANS: Record<DiagramKey, Plan> = {
  badminton: {
    w: 13.4, h: 6.1, cap: 'Badminton court 13.4 × 6.1 m (singles 5.18 m wide). Net 1.524 m at the centre.',
    segs: [[6.7, 0, 6.7, 6.1], [0, 0.46, 13.4, 0.46], [0, 5.64, 13.4, 5.64], [4.72, 0, 4.72, 6.1], [8.68, 0, 8.68, 6.1], [0.76, 0, 0.76, 6.1], [12.64, 0, 12.64, 6.1], [0, 3.05, 4.72, 3.05], [8.68, 3.05, 13.4, 3.05]],
    labels: [[6.7, -0.25, 'Net'], [4.72, 6.7, 'Short service line'], [12.64, 6.7, 'Doubles long service'], [2.4, 2.2, 'Right service court'], [2.4, 4.6, 'Left service court']],
  },
  tt: { w: 2.74, h: 1.525, cap: 'Table 2.74 × 1.525 m, 76 cm high; net 15.25 cm. The centre line matters only in doubles.', segs: [[1.37, 0, 1.37, 1.525]], dashed: [[0, 0.7625, 2.74, 0.7625]], labels: [[1.37, -0.06, 'Net'], [0.35, 1.7, 'End line']] },
  tennis: {
    w: 23.77, h: 10.97, cap: 'Tennis court 23.77 m long; 8.23 m wide for singles, 10.97 m for doubles. Net 0.914 m at the centre.',
    segs: [[11.885, 0, 11.885, 10.97], [0, 1.37, 23.77, 1.37], [0, 9.6, 23.77, 9.6], [5.485, 1.37, 5.485, 9.6], [18.285, 1.37, 18.285, 9.6], [5.485, 5.485, 18.285, 5.485]],
    labels: [[11.885, -0.4, 'Net'], [5.485, 11.9, 'Service line'], [8.7, 3.6, 'Service box'], [1.6, 11.9, 'Baseline']],
  },
  squash: {
    w: 9.75, h: 6.4, cap: 'Squash floor 9.75 × 6.4 m. Serve from a box with the ball landing in the opposite back quarter.',
    segs: [[5.44, 0, 5.44, 6.4], [5.44, 3.2, 9.75, 3.2], [5.44, 0, 5.44, 1.6], [5.44, 1.6, 7.04, 1.6], [7.04, 0, 7.04, 1.6], [5.44, 4.8, 7.04, 4.8], [7.04, 4.8, 7.04, 6.4]],
    labels: [[0.9, 3.3, 'Front wall'], [5.44, -0.3, 'Short line'], [6.24, 0.9, 'Box'], [7.6, 3.05, 'T']],
  },
  football: {
    w: 105, h: 68, cap: 'Football pitch 105 × 68 m: penalty area 16.5 m deep, goal area 5.5 m, penalty spot 11 m, centre circle 9.15 m.',
    segs: [[52.5, 0, 52.5, 68], [0, 13.84, 16.5, 13.84], [16.5, 13.84, 16.5, 54.16], [0, 54.16, 16.5, 54.16], [88.5, 13.84, 105, 13.84], [88.5, 13.84, 88.5, 54.16], [88.5, 54.16, 105, 54.16], [0, 24.84, 5.5, 24.84], [5.5, 24.84, 5.5, 43.16], [0, 43.16, 5.5, 43.16], [99.5, 24.84, 105, 24.84], [99.5, 24.84, 99.5, 43.16], [99.5, 43.16, 105, 43.16]],
    circles: [[52.5, 34, 9.15], [11, 34, 0.4], [94, 34, 0.4]],
    paths: [arc(11, 34, 9.15, -53, 53), arc(94, 34, 9.15, 127, 233)],
    labels: [[52.5, -1.5, 'Halfway'], [8, 11.5, 'Penalty area'], [11, 37.5, '11 m'], [97, 22.5, 'Goal area']],
  },
  basketball: {
    w: 28, h: 15, cap: 'Basketball court 28 × 15 m: three-point arc 6.75 m, key 4.9 m wide, free-throw line 5.8 m from the baseline, hoop 3.05 m high.',
    segs: [[14, 0, 14, 15], [0, 5.05, 5.8, 5.05], [5.8, 5.05, 5.8, 9.95], [0, 9.95, 5.8, 9.95], [22.2, 5.05, 28, 5.05], [22.2, 5.05, 22.2, 9.95], [22.2, 9.95, 28, 9.95], [0, 0.9, 2.99, 0.9], [0, 14.1, 2.99, 14.1], [25.01, 0.9, 28, 0.9], [25.01, 14.1, 28, 14.1]],
    circles: [[14, 7.5, 1.8], [1.575, 7.5, 0.2], [26.425, 7.5, 0.2]],
    paths: [arc(1.575, 7.5, 6.75, -78, 78), arc(26.425, 7.5, 6.75, 102, 258), arc(5.8, 7.5, 1.8, -90, 90), arc(22.2, 7.5, 1.8, 90, 270), arc(1.575, 7.5, 1.25, -90, 90), arc(26.425, 7.5, 1.25, 90, 270)],
    labels: [[14, -0.6, 'Centre'], [9.8, 3.2, '3-point arc'], [2.9, 7.7, 'Key'], [5.8, 11.2, 'Free-throw line']],
  },
  volleyball: { w: 18, h: 9, cap: 'Volleyball court 18 × 9 m; attack lines 3 m from the net. Net 2.43 m (boys), 2.24 m (girls).', segs: [[9, 0, 9, 9], [6, 0, 6, 9], [12, 0, 12, 9]], labels: [[9, -0.4, 'Net'], [6, 9.9, 'Attack line'], [3, 4.7, 'Back row'], [7.5, 4.7, 'Front row']] },
  hockey: {
    w: 91.4, h: 55, cap: 'Hockey pitch 91.4 × 55 m: shooting circle 14.63 m from the posts, penalty spot 6.4 m, 23 m lines.',
    segs: [[45.7, 0, 45.7, 55], [22.9, 0, 22.9, 55], [68.5, 0, 68.5, 55], [14.63, 25.67, 14.63, 29.33], [76.77, 25.67, 76.77, 29.33]],
    circles: [[6.4, 27.5, 0.3], [85, 27.5, 0.3]],
    paths: [arc(0, 25.67, 14.63, -90, 0), arc(0, 29.33, 14.63, 0, 90), arc(91.4, 29.33, 14.63, 90, 180), arc(91.4, 25.67, 14.63, 180, 270)],
    labels: [[22.9, -1.2, '23 m line'], [45.7, -1.2, 'Centre'], [9, 20, 'Circle'], [85, 31.5, '6.4 m']],
  },
  handball: {
    w: 40, h: 20, cap: 'Handball court 40 × 20 m: goal area 6 m (goalkeeper only), free-throw line 9 m, penalty line 7 m. Goal 3 × 2 m.',
    segs: [[20, 0, 20, 20], [6, 8.5, 6, 11.5], [34, 8.5, 34, 11.5], [7, 9.5, 7, 10.5], [33, 9.5, 33, 10.5]],
    dashed: [[9, 8.5, 9, 11.5], [31, 8.5, 31, 11.5]],
    paths: [arc(0, 8.5, 6, -90, 0), arc(0, 11.5, 6, 0, 90), arc(40, 11.5, 6, 90, 180), arc(40, 8.5, 6, 180, 270), arc(0, 8.5, 9, -90, 0), arc(0, 11.5, 9, 0, 90), arc(40, 11.5, 9, 90, 180), arc(40, 8.5, 9, 180, 270)],
    labels: [[3, 4, 'Goal area'], [11.5, 4, '9 m'], [7, 12.4, '7 m'], [20, -0.5, 'Centre']],
  },
  kabaddi: {
    w: 13, h: 10, cap: 'Kabaddi court 13 × 10 m (boys): mid line, baulk line 3.75 m from it, bonus line 1 m beyond, 1 m lobbies down each side.',
    segs: [[6.5, 0, 6.5, 10], [2.75, 1, 2.75, 9], [10.25, 1, 10.25, 9], [1.75, 1, 1.75, 9], [11.25, 1, 11.25, 9], [0, 1, 13, 1], [0, 9, 13, 9]],
    labels: [[6.5, -0.3, 'Mid line'], [2.75, 9.8, 'Baulk'], [1.75, 0.7, 'Bonus'], [6.5, 9.7, 'Lobby'], [4.6, 5.2, 'Raider crosses here']],
  },
  khokho: {
    w: 27, h: 16, cap: 'Kho-Kho field 27 × 16 m: two poles 23.5 m apart joined by the central lane, eight cross lanes, a free zone beyond each pole.',
    segs: [[1.75, 7.85, 25.25, 7.85], [1.75, 8.15, 25.25, 8.15], ...Array.from({ length: 8 }, (_, i): Seg => [4.35 + i * 2.6, 0, 4.35 + i * 2.6, 16])],
    circles: [[1.75, 8, 0.3], [25.25, 8, 0.3]],
    labels: [[1.75, 6.8, 'Pole'], [13.5, 6.9, 'Central lane'], [4.35, -0.4, 'Cross lane'], [0.85, 12, 'Free'], [0.85, 13.2, 'zone']],
  },
  cricket: {
    w: 24, h: 6, cap: 'The pitch: 20.12 m between the stumps (22 yards). The popping crease is 1.22 m in front of each bowling crease.',
    segs: [[1.94, 1.68, 1.94, 4.32], [22.06, 1.68, 22.06, 4.32], [3.16, 0.5, 3.16, 5.5], [20.84, 0.5, 20.84, 5.5], [1.94, 1.68, 3.7, 1.68], [1.94, 4.32, 3.7, 4.32], [20.3, 1.68, 22.06, 1.68], [20.3, 4.32, 22.06, 4.32]],
    circles: [[1.94, 3, 0.15], [22.06, 3, 0.15]],
    labels: [[1.94, 1.2, 'Stumps'], [3.16, -0.2, 'Popping crease'], [12, 3.3, '20.12 m'], [22.06, 5.9, 'Bowling crease']],
  },
  throwball: { w: 18.3, h: 12.2, cap: 'Throwball court 18.3 × 12.2 m with a 1.5 m neutral zone either side of the 2.2 m net.', segs: [[9.15, 0, 9.15, 12.2]], dashed: [[7.65, 0, 7.65, 12.2], [10.65, 0, 10.65, 12.2]], labels: [[9.15, -0.4, 'Net'], [7.65, 12.9, 'Neutral zone'], [3.8, 6.4, '7 players']] },
  track: {
    w: 176, h: 96, cap: 'A 400 m track: two 84.39 m straights and two bends of 36.5 m radius, eight lanes 1.22 m wide. Sprints stay in lane; the 200 m and 400 m start staggered.',
    paths: [
      ...Array.from({ length: 8 }, (_, i) => { const r = 36.5 + i * 1.22 + 0.5; const x0 = 45.8; const x1 = 45.8 + 84.39; const cy = 48; return `M ${x0} ${cy - r} L ${x1} ${cy - r} A ${r} ${r} 0 0 1 ${x1} ${cy + r} L ${x0} ${cy + r} A ${r} ${r} 0 0 1 ${x0} ${cy - r}`; }),
      'M 130.19 84 L 130.19 95.5',
    ],
    labels: [[88, 92, 'Finish straight'], [88, 8, 'Back straight'], [130.19, 79, 'Finish'], [10, 48, 'Bend']],
  },
  jumps: {
    w: 52, h: 6, cap: 'Long jump: a 40 m runway, the 20 cm take-off board, 1 m of sand before the pit proper (2.75 × 9 m). High jump uses a fan-shaped run-up to a 4 m bar.',
    segs: [[0, 2.39, 40, 2.39], [0, 3.61, 40, 3.61], [40, 0.5, 40, 5.5], [40.2, 0.5, 40.2, 5.5], [43, 1.62, 52, 1.62], [43, 4.38, 52, 4.38], [43, 1.62, 43, 4.38]],
    labels: [[20, 2, 'Runway 1.22 m wide'], [40.1, -0.2, 'Board'], [47.5, 3.2, 'Sand pit'], [41.5, 5.9, 'Foul']],
  },
  throws: {
    w: 50, h: 34, cap: 'Shot and discus: a circle (2.135 m / 2.5 m) and a 34.92° landing sector. Javelin: a run-up ending at an arc and a 28.96° sector.',
    circles: [[6, 17, 2.5], [6, 17, 0.2]],
    segs: [[6, 17, 48, 17 - 42 * Math.tan((17.46 * Math.PI) / 180)], [6, 17, 48, 17 + 42 * Math.tan((17.46 * Math.PI) / 180)]],
    paths: [arc(6, 17, 2.5, 60, 300)],
    labels: [[6, 22, 'Circle'], [30, 15.5, '34.92° sector'], [6, 12, 'Cage']],
  },
  pool: {
    w: 25, h: 15, cap: 'A 25 m school pool with six 2.5 m lanes. Backstroke flags 5 m from each wall; 15 m marks the underwater limit after a start or turn.',
    segs: [...Array.from({ length: 5 }, (_, i): Seg => [0, 2.5 * (i + 1), 25, 2.5 * (i + 1)]), [0, 0, 0, 15], [25, 0, 25, 15]],
    dashed: [[5, 0, 5, 15], [20, 0, 20, 15], [15, 0, 15, 15]],
    labels: [[5, -0.4, '5 m flags'], [15, -0.4, '15 m'], [20, -0.4, '5 m flags'], [1.5, 16, 'Blocks'], [12.5, 8.1, 'Lane 3']],
  },
  ring: {
    w: 6.1, h: 6.1, cap: 'A boxing ring 6.1 m inside the ropes (4.9 m acceptable for school). Red and blue corners face each other; the other two are neutral.',
    segs: [[0.15, 0.15, 5.95, 0.15], [0.15, 5.95, 5.95, 5.95], [0.15, 0.15, 0.15, 5.95], [5.95, 0.15, 5.95, 5.95]],
    circles: [[0.15, 0.15, 0.25], [5.95, 5.95, 0.25], [5.95, 0.15, 0.25], [0.15, 5.95, 0.25]],
    labels: [[0.7, 0.75, 'Red'], [5.35, 5.6, 'Blue'], [5.3, 0.75, 'Neutral'], [0.8, 5.6, 'Neutral'], [3.05, 3.2, 'Referee, 3 judges']],
  },
  mat: {
    w: 10, h: 10, cap: 'A combat mat: 8 × 8 m contest area inside a 1 m safety area (judo, karate, taekwondo). Wrestling marks a 9 m circle with a 1 m passivity zone.',
    segs: [[1, 1, 9, 1], [1, 9, 9, 9], [1, 1, 1, 9], [9, 1, 9, 9], [4, 5, 4.6, 5], [5.4, 5, 6, 5]],
    circles: [[5, 5, 4.5], [5, 5, 3.5]],
    labels: [[5, 0.7, 'Safety area'], [5, 5.9, 'Start marks'], [5, 9.6, '8 × 8 m contest area'], [2.5, 3, '9 m circle']],
  },
  target: {
    w: 12, h: 12, cap: 'An archery face: ten rings, 10 in the gold centre down to 1 in the outer white. A line-cutter scores the higher ring.',
    fills: [
      ...[['#fff', 6], ['#222', 4.8], ['#2f6fdd', 3.6], ['#d3252b', 2.4], ['#f2c400', 1.2]].map(([c, r]) => ({ d: `M ${6 - Number(r)} 6 A ${r} ${r} 0 1 0 ${6 + Number(r)} 6 A ${r} ${r} 0 1 0 ${6 - Number(r)} 6`, fill: String(c) })),
    ],
    circles: Array.from({ length: 10 }, (_, i): [number, number, number] => [6, 6, 0.6 * (i + 1)]),
    labels: [[6, 6.35, '10'], [6, 3.6, '8'], [6, 1.2, '4'], [6, 12.6, 'Line-cutters score the higher ring']],
  },
  chess: {
    w: 8, h: 8, cap: 'The board sits with a light square in each player\'s right-hand corner; the queen starts on her own colour.',
    fills: Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8) })).filter((s) => (s.x + s.y) % 2 === 1).map((s) => ({ d: `M ${s.x} ${s.y} h 1 v 1 h -1 z`, fill: 'var(--sk-line-2)' })),
    labels: [...'abcdefgh'.split('').map((f, i): [number, number, string] => [i + 0.5, 8.7, f]), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [number, number, string] => [-0.4, 8.6 - n, String(n)]), [3.5, 7.65, 'Q'], [4.5, 7.65, 'K'], [3.5, 0.65, 'Q'], [4.5, 0.65, 'K']],
  },
  carrom: {
    w: 74, h: 74, cap: 'A carrom board: 74 cm playing surface, pockets 4.45 cm, base lines 47 cm long with a circle at each end, the centre circle 17 cm across.',
    segs: [[13.5, 10, 60.5, 10], [13.5, 13.2, 60.5, 13.2], [13.5, 60.8, 60.5, 60.8], [13.5, 64, 60.5, 64], [10, 13.5, 10, 60.5], [13.2, 13.5, 13.2, 60.5], [60.8, 13.5, 60.8, 60.5], [64, 13.5, 64, 60.5]],
    circles: [[37, 37, 8.5], [37, 37, 1.6], [13.5, 11.6, 1.6], [60.5, 11.6, 1.6], [13.5, 62.4, 1.6], [60.5, 62.4, 1.6], [11.6, 13.5, 1.6], [11.6, 60.5, 1.6], [62.4, 13.5, 1.6], [62.4, 60.5, 1.6], [3.5, 3.5, 2.2], [70.5, 3.5, 2.2], [3.5, 70.5, 2.2], [70.5, 70.5, 2.2]],
    paths: ['M 14 14 L 30 30', 'M 60 14 L 44 30', 'M 14 60 L 30 44', 'M 60 60 L 44 44'],
    labels: [[37, 8, 'Base line'], [37, 39, 'Centre'], [8, 2.5, 'Pocket'], [22, 24, 'Arrow']],
  },
};

export function SportDiagram({ diagram }: { diagram: DiagramKey }) {
  return <Court p={PLANS[diagram]} />;
}
