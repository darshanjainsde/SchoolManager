/**
 * The sports catalogue — the one source of truth for the desk, the admin
 * console, the student's portal and the API. Pure data and pure helpers with
 * no imports, so it ships to every app unchanged and the rules book never
 * needs a request.
 *
 * Three kinds of sport:
 *   MATCH     two sides, a scoreline, a winner → knockout brackets
 *   MEASURED  a mark per athlete (time, distance, height, points) → heats
 *   JUDGED    a panel mark per athlete → one round, ranked
 *
 * Three ways to score:
 *   GAMES   best-of-N games, each to `to` points, win by `winBy`, capped at
 *           `cap`; `finalTo` is a shorter deciding game (volleyball 15)
 *   SINGLE  one number a side (goals, points, runs); a tie is broken by the
 *           optional second number — the decider (penalties, super over …)
 *   MARK    the measured or judged number, with its unit and direction
 */

export type SportKind = 'MATCH' | 'MEASURED' | 'JUDGED';
export type SportGroup = 'Athletics' | 'Swimming' | 'Racket' | 'Team' | 'Combat' | 'Precision' | 'Mind' | 'Fitness';
export type SportCategory = 'Boys' | 'Girls' | 'Mixed';

export const SPORT_GROUPS: readonly SportGroup[] = ['Athletics', 'Swimming', 'Racket', 'Team', 'Combat', 'Precision', 'Mind', 'Fitness'];
export const SPORT_CATEGORIES: readonly SportCategory[] = ['Boys', 'Girls', 'Mixed'];

export type MarkUnit = 's' | 'm' | 'kg' | 'pts' | 'reps';

export interface GamesScoring { type: 'GAMES'; label: string; bestOf: number; to: number; winBy: number; cap?: number; finalTo?: number }
export interface SingleScoring { type: 'SINGLE'; label: string; decider: string }
export interface MarkScoring { type: 'MARK'; label: string; unit: MarkUnit; lowerIsBetter: boolean; precision: number }
export type Scoring = GamesScoring | SingleScoring | MarkScoring;

/** Which drawing the rules book shows above the text. The web owns the SVGs. */
export type DiagramKey =
  | 'track' | 'jumps' | 'throws' | 'pool'
  | 'badminton' | 'tt' | 'tennis' | 'squash'
  | 'football' | 'basketball' | 'volleyball' | 'hockey' | 'handball' | 'kabaddi' | 'khokho' | 'cricket' | 'throwball'
  | 'ring' | 'mat' | 'target' | 'chess' | 'carrom';

export interface RulesSection { title: string; points: string[] }
export interface SportRules { summary: string; diagram?: DiagramKey; sections: RulesSection[] }

export interface Sport {
  key: string;
  name: string;
  group: SportGroup;
  kind: SportKind;
  /** 1 = individual. More = a team: sides are then sections (9 A vs 9 B), not students. */
  teamSize: number;
  scoring: Scoring;
  /** Minutes one match, heat or panel round needs on a venue. */
  slotMin: number;
  /** MEASURED / JUDGED: how many go together in one heat or flight. */
  lanes?: number;
  /** What the venue is called on the day board. */
  venue: string;
  categories: readonly SportCategory[];
  /** On the Olympic programme (or its school-level form). */
  olympic: boolean;
  rules: SportRules;
}

const BG: readonly SportCategory[] = ['Boys', 'Girls'];
const ALL: readonly SportCategory[] = ['Boys', 'Girls', 'Mixed'];

const time = (label: string): MarkScoring => ({ type: 'MARK', label, unit: 's', lowerIsBetter: true, precision: 2 });
const distance = (label: string): MarkScoring => ({ type: 'MARK', label, unit: 'm', lowerIsBetter: false, precision: 2 });
const points = (label: string, precision: number): MarkScoring => ({ type: 'MARK', label, unit: 'pts', lowerIsBetter: false, precision });
const games = (label: string, bestOf: number, to: number, winBy: number, cap?: number, finalTo?: number): GamesScoring =>
  ({ type: 'GAMES', label, bestOf, to, winBy, ...(cap ? { cap } : {}), ...(finalTo ? { finalTo } : {}) });
const single = (label: string, decider: string): SingleScoring => ({ type: 'SINGLE', label, decider });

// ── shared rule sections ──────────────────────────────────────
const TRACK_COMMON: RulesSection[] = [
  { title: 'The start', points: [
    'Sprints up to 400 m start from blocks or a crouch, each runner in their own lane for the whole race.',
    'On "On your marks" settle; on "Set" hold still; move only on the gun. A false start is one warning for the field in school meets, then disqualification.',
    '200 m and 400 m start staggered so every lane runs the same distance. Do not step on or over the inside lane line.',
  ] },
  { title: 'Finishing and placing', points: [
    'The place is decided by the torso reaching the finish line — not the head, arms or feet.',
    'Times are taken to 0.01 s. In heats the fastest times across all heats go through to the final.',
    'Lanes for the final are drawn by rank: the fastest qualifiers get the centre lanes.',
  ] },
];
const FIELD_ATTEMPTS: RulesSection = { title: 'Attempts and marks', points: [
  'Every athlete gets three attempts; the best legal mark counts. With a big field the top eight get three more.',
  'A tie is broken by the second-best mark, then the third-best.',
  'Measure from the nearest break in the landing to the take-off or circle edge, along a line at right angles to it, rounded down to the centimetre.',
] };
const SWIM_COMMON: RulesSection[] = [
  { title: 'Start and lanes', points: [
    'One-start rule: leaving the block before the signal is disqualification (school meets give one warning to the field).',
    'Lanes are seeded so the fastest entries swim in the centre lanes. Stay in your lane; touching the lane rope is fine, pulling on it is not.',
    'After the start and every turn a swimmer may stay under water for at most 15 m (no limit in breaststroke, but only one pull-down and kick).',
  ] },
  { title: 'Finishing', points: [
    'Times are taken to 0.01 s. Heats send the fastest times through to the final; equal times at the cut go to a swim-off.',
    'A swimmer who does not finish, misses a touch or breaks a stroke rule is marked DQ and takes no place.',
  ] },
];
const KNOCKOUT_TIE = (decider: string): RulesSection => ({ title: 'When it is level', points: [
  `A knockout match cannot end level. Play the decider: ${decider}.`,
  'Record the decider as the second number on the scoresheet so the tie is visible in the history.',
] });

// ── the catalogue ─────────────────────────────────────────────
export const SPORTS: readonly Sport[] = [
  // Athletics — track
  ...[
    ['ath-100m', '100 m sprint', 6, 5], ['ath-200m', '200 m sprint', 6, 5], ['ath-400m', '400 m', 6, 6],
    ['ath-800m', '800 m', 8, 8], ['ath-1500m', '1500 m', 12, 10],
  ].map(([key, name, lanes, slotMin]): Sport => ({
    key: key as string, name: name as string, group: 'Athletics', kind: 'MEASURED', teamSize: 1, scoring: time('Time'),
    slotMin: slotMin as number, lanes: lanes as number, venue: 'Track', categories: BG, olympic: true,
    rules: {
      summary: name === '800 m' || name === '1500 m'
        ? 'Middle distance: start in lanes (800 m) or from a curved line (1500 m), then break to the inside. Fastest time wins.'
        : 'Run your lane from gun to line. Fastest time wins; the torso decides a close finish.',
      diagram: 'track',
      sections: name === '800 m' || name === '1500 m'
        ? [
          { title: 'The start', points: [
            '800 m starts in lanes and breaks to the inside after the first bend; 1500 m starts from a curved line with no lanes.',
            'Once you break, do not cut in front of another runner without a clear stride of space — obstruction is disqualification.',
            'A false start is one warning for the field in school meets, then disqualification.',
          ] },
          TRACK_COMMON[1],
        ]
        : TRACK_COMMON,
    },
  })),
  {
    key: 'ath-hurdles', name: 'Hurdles', group: 'Athletics', kind: 'MEASURED', teamSize: 1, scoring: time('Time'),
    slotMin: 6, lanes: 6, venue: 'Track', categories: BG, olympic: true,
    rules: {
      summary: '80 m for under-14, 100 m girls and 110 m boys for under-17 and up, over ten hurdles in your own lane.',
      diagram: 'track',
      sections: [
        { title: 'The hurdles', points: [
          'Ten hurdles per race. Heights: 76.2 cm for under-14 and under-17 girls, 91.4 cm for under-17 boys and above.',
          'Knocking a hurdle over is not a foul by itself. Deliberately knocking one with a hand, or running around or outside a hurdle, is disqualification.',
          'Your trailing leg must clear the hurdle at its height — dragging it round the side is a foul.',
        ] },
        ...TRACK_COMMON,
      ],
    },
  },
  // Athletics — field
  {
    key: 'ath-long-jump', name: 'Long jump', group: 'Athletics', kind: 'MEASURED', teamSize: 1, scoring: distance('Distance'),
    slotMin: 30, lanes: 12, venue: 'Pit', categories: BG, olympic: true,
    rules: {
      summary: 'Run up, take off from the board, land in the sand. The best of three legal jumps counts.',
      diagram: 'jumps',
      sections: [
        { title: 'Take-off', points: [
          'Take off from the 20 cm board. Any part of the foot over the front edge is a foul — the plasticine strip shows the mark.',
          'Somersaulting, or landing then walking back through the pit, is a foul. Leave the pit forward of your mark.',
        ] },
        FIELD_ATTEMPTS,
      ],
    },
  },
  {
    key: 'ath-high-jump', name: 'High jump', group: 'Athletics', kind: 'MEASURED', teamSize: 1,
    scoring: { type: 'MARK', label: 'Height', unit: 'm', lowerIsBetter: false, precision: 2 },
    slotMin: 45, lanes: 12, venue: 'Pit', categories: BG, olympic: true,
    rules: {
      summary: 'The bar rises in steps. Three failures in a row and you are out; your best cleared height stands.',
      diagram: 'jumps',
      sections: [
        { title: 'Clearing the bar', points: [
          'Take off from one foot. Touching the bar is fine as long as it stays up; a bar that falls is a failure.',
          'Passing under or beside the bar, or touching the mat beyond the plane of the bar before clearing it, is a failure.',
        ] },
        { title: 'Heights and ties', points: [
          'The bar goes up by 3–5 cm each round. You may pass a height and come in later; three consecutive failures at any heights end your competition.',
          'Tie at the same best height: fewest failures at that height wins, then fewest failures overall, then a jump-off for first place.',
        ] },
      ],
    },
  },
  {
    key: 'ath-shot-put', name: 'Shot put', group: 'Athletics', kind: 'MEASURED', teamSize: 1, scoring: distance('Distance'),
    slotMin: 30, lanes: 12, venue: 'Circle', categories: BG, olympic: true,
    rules: {
      summary: 'Put the shot from the shoulder, one hand, inside a 2.135 m circle, into the sector. Best of three counts.',
      diagram: 'throws',
      sections: [
        { title: 'The put', points: [
          'The shot rests at the neck and is pushed, not thrown — it must not drop below the line of the shoulder during the put.',
          'Stay inside the circle until the shot lands, then leave from the rear half. Touching the top of the stop board or the ring is a foul.',
          'The shot must land inside the 34.92° sector lines.',
        ] },
        { title: 'Shot weights (school)', points: [
          'Under-14: 4 kg boys, 3 kg girls. Under-17: 5 kg boys, 3 kg girls. Under-19: 6 kg boys, 4 kg girls. (Senior: 7.26 kg / 4 kg.)',
        ] },
        FIELD_ATTEMPTS,
      ],
    },
  },
  {
    key: 'ath-discus', name: 'Discus', group: 'Athletics', kind: 'MEASURED', teamSize: 1, scoring: distance('Distance'),
    slotMin: 40, lanes: 12, venue: 'Circle', categories: BG, olympic: true,
    rules: {
      summary: 'Throw from a 2.5 m circle inside the safety cage into the sector. Best of three counts.',
      diagram: 'throws',
      sections: [
        { title: 'The throw', points: [
          'Start from a standstill inside the circle; the discus may touch the cage in flight without foul, but must land inside the 34.92° sector.',
          'Leave the circle from the rear half only after the discus has landed. Stepping on the ring is a foul.',
          'Nobody stands in the sector while a thrower is in the circle — the cage and the sector are cleared first.',
        ] },
        { title: 'Discus weights (school)', points: [
          'Under-14: 1 kg. Under-17: 1.5 kg boys, 1 kg girls. Under-19 and senior: 2 kg boys / 1.75 kg, 1 kg girls.',
        ] },
        FIELD_ATTEMPTS,
      ],
    },
  },
  {
    key: 'ath-javelin', name: 'Javelin', group: 'Athletics', kind: 'MEASURED', teamSize: 1, scoring: distance('Distance'),
    slotMin: 40, lanes: 12, venue: 'Runway', categories: BG, olympic: true,
    rules: {
      summary: 'Run up and throw over the shoulder; the tip must strike first inside the sector. Best of three counts.',
      diagram: 'throws',
      sections: [
        { title: 'The throw', points: [
          'Throw over the shoulder with one hand — no slinging or turning. Run-up 30–36.5 m, 4 m wide, ending at the curved foul arc.',
          'The javelin must land tip first inside the 28.96° sector; flat or tail-first landings do not count.',
          'Do not cross the arc or its side extensions until the javelin has landed; leave the runway behind the arc.',
        ] },
        { title: 'Javelin weights (school)', points: [
          'Under-14: 400 g. Under-17: 700 g boys, 500 g girls. Under-19: 800 g boys, 600 g girls (same as senior).',
        ] },
        FIELD_ATTEMPTS,
      ],
    },
  },
  // Swimming
  ...[
    ['swim-50-free', '50 m freestyle', 'Any stroke, any turn, touch the wall with any part of the body.', [
      'Freestyle means any stroke; nearly everyone swims front crawl.',
      'Some part of the body must break the surface throughout, except the 15 m after the start and each turn.',
      'Touch the wall with any part of the body at the turn and the finish.',
    ]],
    ['swim-100-free', '100 m freestyle', 'Two lengths of a 50 m pool or four of a 25 m pool, any stroke.', [
      'Freestyle means any stroke; nearly everyone swims front crawl.',
      'Some part of the body must break the surface throughout, except the 15 m after the start and each turn.',
      'Touch the wall with any part of the body at every turn and the finish.',
    ]],
    ['swim-50-back', '50 m backstroke', 'Start in the water, race on your back, finish on your back.', [
      'Start holding the grips, feet under the surface. Stay on the back for the whole race except during the turn.',
      'At the turn you may roll onto the front for one continuous arm pull into the wall; you must be on your back when you leave it.',
      'Finish touching the wall while on the back. Being past vertical toward the breast at the finish is disqualification.',
    ]],
    ['swim-50-breast', '50 m breaststroke', 'Arms and legs move together and symmetrically; two-hand touch.', [
      'Arms and legs move at the same time, in the same horizontal plane, symmetrically. Hands may not pull past the hip line except in the first stroke after the start and turns.',
      'The head must break the surface once in every full stroke cycle. No dolphin kick except one downward kick in the pull-down.',
      'Touch with both hands at the same time, separated, at the turn and the finish.',
    ]],
    ['swim-50-fly', '50 m butterfly', 'Both arms over the water together, dolphin kick, two-hand touch.', [
      'Both arms recover over the water together and pull together; the legs kick together (dolphin). No flutter or breaststroke kick.',
      'Shoulders stay level with the surface from the first stroke after the start and each turn.',
      'Touch with both hands at the same time at the turn and the finish.',
    ]],
  ].map(([key, name, summary, stroke]): Sport => ({
    key: key as string, name: name as string, group: 'Swimming', kind: 'MEASURED', teamSize: 1, scoring: time('Time'),
    slotMin: 5, lanes: 6, venue: 'Pool', categories: BG, olympic: true,
    rules: { summary: summary as string, diagram: 'pool', sections: [{ title: 'The stroke', points: stroke as string[] }, ...SWIM_COMMON] },
  })),
  // Racket
  {
    key: 'badminton', name: 'Badminton', group: 'Racket', kind: 'MATCH', teamSize: 1, scoring: games('Games', 3, 21, 2, 30),
    slotMin: 25, venue: 'Court', categories: ALL, olympic: true,
    rules: {
      summary: 'Best of three games to 21, rally point, win by two, capped at 30. Serve from the right when your score is even.',
      diagram: 'badminton',
      sections: [
        { title: 'Scoring', points: [
          'Every rally scores a point, whoever served. A game is 21 points; at 20-all you need two clear points; at 29-all the next point wins.',
          'Best of three games. Change ends after each game and when the leader reaches 11 in the third game.',
          'A shuttle landing on a line is in.',
        ] },
        { title: 'Serving', points: [
          'Serve diagonally: from the right service court when your score is even, from the left when it is odd. The winner of a rally serves the next.',
          'The whole shuttle must be below 1.15 m (or the waist, where no measuring device is used) when struck, with the racket head pointing down. Both feet stay on the floor until it is hit.',
          'In singles the service court is long and narrow (back line in, side tramline out); in doubles it is short and wide.',
        ] },
        { title: 'Faults', points: [
          'The shuttle lands outside, passes under or through the net, or touches the ceiling, a wall or a player\'s body or clothes.',
          'A player touches the net or posts with racket or body, reaches over the net to hit, or hits the shuttle twice.',
          'The court is 13.4 m long; 5.18 m wide for singles, 6.1 m for doubles. Net height 1.524 m at the centre, 1.55 m at the posts.',
        ] },
      ],
    },
  },
  {
    key: 'table-tennis', name: 'Table tennis', group: 'Racket', kind: 'MATCH', teamSize: 1, scoring: games('Games', 5, 11, 2),
    slotMin: 20, venue: 'Table', categories: ALL, olympic: true,
    rules: {
      summary: 'Games to 11, win by two, best of five. Two serves each, alternating; every point alternates from 10-all.',
      diagram: 'tt',
      sections: [
        { title: 'Scoring', points: [
          'A game is 11 points, win by two — 10-all continues until someone leads by two. Best of five games (best of seven in senior finals).',
          'Change ends after every game, and in the deciding game when the first player reaches 5.',
          'The ball must bounce once on your side before you return it; a ball touching the top edge of the table is in, the side is out.',
        ] },
        { title: 'Serving', points: [
          'Rest the ball on an open, flat palm behind the end line and above the table. Toss it at least 16 cm nearly vertically and strike it as it falls.',
          'The ball must bounce on your side first, then on the receiver\'s side. In singles it may land anywhere on the far side.',
          'Two serves each, alternating. From 10-all, serve alternates every point. A serve that clips the net and lands in is a let, replayed.',
        ] },
        { title: 'Faults', points: [
          'Volleying (hitting the ball before it bounces on your side), touching the table with the free hand, moving the table, or touching the net.',
          'Obstructing the ball with the body or racket when it is over or heading toward your side.',
          'Table 2.74 × 1.525 m, 76 cm high; net 15.25 cm.',
        ] },
      ],
    },
  },
  {
    key: 'tennis', name: 'Tennis', group: 'Racket', kind: 'MATCH', teamSize: 1, scoring: games('Sets', 3, 6, 2, 7),
    slotMin: 60, venue: 'Court', categories: ALL, olympic: true,
    rules: {
      summary: 'Points 15-30-40-game, deuce and advantage; six games win a set with two clear, tie-break at 6-6. Best of three sets.',
      diagram: 'tennis',
      sections: [
        { title: 'Scoring', points: [
          'A game: 15, 30, 40, game. At 40-40 (deuce) a player must win two points in a row — advantage, then game.',
          'A set: first to six games with a two-game lead. At 6-6 a tie-break to seven points, win by two, decides the set 7-6.',
          'Best of three sets. School events often play short sets to four games with a tie-break at 4-4 — say so in the event notes.',
        ] },
        { title: 'Serving', points: [
          'Serve from behind the baseline, diagonally into the opposite service box. Two serves per point; a serve touching the net and landing in is a let, replayed.',
          'Stepping on or over the baseline before striking is a foot fault. The server alternates right and left courts each point.',
          'Players change ends after the first game and every odd game after that.',
        ] },
        { title: 'Court and lines', points: [
          'Court 23.77 m long; 8.23 m wide for singles, 10.97 m for doubles. Net 0.914 m at the centre.',
          'A ball touching any part of a line is in. A ball may be hit before it bounces (volley) anywhere except on the return of serve.',
        ] },
      ],
    },
  },
  {
    key: 'squash', name: 'Squash', group: 'Racket', kind: 'MATCH', teamSize: 1, scoring: games('Games', 5, 11, 2),
    slotMin: 30, venue: 'Court', categories: ALL, olympic: true,
    rules: {
      summary: 'Games to 11, win by two, best of five. Every shot must reach the front wall above the tin and below the out line.',
      diagram: 'squash',
      sections: [
        { title: 'Scoring', points: ['Point-a-rally to 11, win by two, best of five games.', 'The winner of a rally serves the next; the server chooses the box for the first serve of a game and then alternates boxes after each point won.'] },
        { title: 'Serving and play', points: [
          'One foot inside the service box; the ball must hit the front wall between the service line and the out line and land in the opposite back quarter.',
          'Returns may hit side or back walls first but must reach the front wall above the tin (43 cm) and below the out line. The ball may bounce once.',
          'Court 9.75 × 6.4 m. Front wall out line 4.57 m, back wall 2.13 m, service line 1.78 m.',
        ] },
        { title: 'Interference', points: ['If a player is blocked, play stops: a let replays the rally; a stroke gives the point to the obstructed player when a winning shot was denied.'] },
      ],
    },
  },
  // Team
  {
    key: 'football', name: 'Football', group: 'Team', kind: 'MATCH', teamSize: 11, scoring: single('Goals', 'Penalties'),
    slotMin: 60, venue: 'Field', categories: BG, olympic: true,
    rules: {
      summary: 'Eleven a side, two halves. Most goals wins; a level knockout goes to penalties.',
      diagram: 'football',
      sections: [
        { title: 'The game', points: [
          'Eleven players including a goalkeeper (school: seven a side on a half pitch is fine — set it in the event notes). Rolling substitutions in school play.',
          'Two halves of 45 minutes (school: 25–30). A goal counts when the whole ball crosses the goal line between the posts.',
          'Only the goalkeeper may handle the ball, inside their own penalty area.',
        ] },
        { title: 'Offside', points: [
          'A player is offside when, in the opponents\' half, they are nearer the goal line than both the ball and the second-last defender at the moment a team-mate plays the ball to them.',
          'No offside from a goal kick, corner or throw-in. Being level with the second-last defender is onside.',
        ] },
        { title: 'Fouls and restarts', points: [
          'Kicking, tripping, pushing, holding or handling is a direct free kick — a penalty if inside the defending penalty area. Dangerous play and obstruction give an indirect free kick.',
          'Yellow card for a caution, red for a second yellow or serious foul play — the player leaves and is not replaced.',
          'Throw-in with both feet on the ground and the ball delivered from behind the head; goal kick when the attackers put it out over the goal line; corner when the defenders do.',
        ] },
        KNOCKOUT_TIE('five penalties each, then sudden death'),
      ],
    },
  },
  {
    key: 'basketball', name: 'Basketball', group: 'Team', kind: 'MATCH', teamSize: 5, scoring: single('Points', 'Extra period'),
    slotMin: 40, venue: 'Court', categories: BG, olympic: true,
    rules: {
      summary: 'Five a side, four quarters. Two points inside the arc, three outside, one per free throw. Level scores play extra periods.',
      diagram: 'basketball',
      sections: [
        { title: 'The game', points: [
          'Five on court, up to seven substitutes. Four quarters of 10 minutes (school: 8). Overtime periods of 5 minutes until there is a winner.',
          'Field goal: two points inside the 6.75 m arc, three from beyond it. Free throw: one point. The hoop is 3.05 m high.',
          'Court 28 × 15 m. The team must cross halfway within 8 seconds and shoot within 24 seconds (school: often 30 or no shot clock).',
        ] },
        { title: 'Violations', points: [
          'Travelling — moving both feet with the ball without dribbling. Double dribble — dribbling again after stopping.',
          'Three seconds in the key on attack; five seconds holding the ball when closely guarded; taking the ball back over halfway after crossing it.',
          'Kicking the ball deliberately, or touching it on its downward path to the basket (goaltending).',
        ] },
        { title: 'Fouls', points: [
          'Personal fouls: holding, pushing, charging, blocking illegally, hitting an arm. Five personal fouls and the player is out.',
          'From a team\'s fifth foul in a quarter every further foul gives two free throws. A foul on a shooter gives two (or three) free throws; if the shot went in, one.',
          'Unsportsmanlike and technical fouls give free throws plus possession; two of either means ejection.',
        ] },
      ],
    },
  },
  {
    key: 'volleyball', name: 'Volleyball', group: 'Team', kind: 'MATCH', teamSize: 6, scoring: games('Sets', 5, 25, 2, undefined, 15),
    slotMin: 45, venue: 'Court', categories: BG, olympic: true,
    rules: {
      summary: 'Six a side, sets to 25 rally point with two clear, best of five; the fifth set is to 15. Three touches to get it over.',
      diagram: 'volleyball',
      sections: [
        { title: 'Scoring', points: [
          'Every rally scores. Sets to 25, win by two, no cap. Best of five; a deciding fifth set is to 15 (school: best of three is common).',
          'The team winning a rally serves next; when they win it back from the opponents, they rotate one position clockwise.',
          'Change ends after each set; in the fifth, at 8 points.',
        ] },
        { title: 'Playing the ball', points: [
          'At most three touches to return the ball (a block does not count). No player may touch it twice in a row except on the first touch after a block or an attack.',
          'Back-row players may attack only from behind the 3 m line. The libero (defensive specialist) may not serve, block or attack above the net.',
          'A ball touching any line is in. A ball that touches the net on its way over — including a serve — stays in play.',
        ] },
        { title: 'Faults', points: [
          'Touching the top band of the net during play, reaching over to block a set, or stepping fully over the centre line under the net.',
          'Catching or throwing the ball, four touches, serving before the whistle or out of rotation.',
          'Court 18 × 9 m. Net 2.43 m (boys), 2.24 m (girls); under-17: 2.35 m / 2.20 m.',
        ] },
      ],
    },
  },
  {
    key: 'hockey', name: 'Hockey', group: 'Team', kind: 'MATCH', teamSize: 11, scoring: single('Goals', 'Shoot-out'),
    slotMin: 60, venue: 'Field', categories: BG, olympic: true,
    rules: {
      summary: 'Eleven a side, four quarters. Goals count only from inside the circle; play the flat side of the stick only.',
      diagram: 'hockey',
      sections: [
        { title: 'The game', points: [
          'Eleven players including a goalkeeper. Four quarters of 15 minutes (school: two halves of 25). Pitch 91.4 × 55 m.',
          'A goal counts only when the ball is touched by an attacker inside the shooting circle before crossing the goal line.',
          'Rolling substitutions at any time except during a penalty corner.',
        ] },
        { title: 'Stick and ball', points: [
          'Play with the flat side of the stick only — the rounded back is a foul. Only the goalkeeper may use feet or body.',
          'No raising the stick dangerously above the shoulder, no hooking or hitting another stick, no playing the ball in the air toward an opponent within 5 m.',
          'Obstruction: shielding the ball with the body or stick from an opponent who is trying to play it.',
        ] },
        { title: 'Penalties', points: [
          'A foul by a defender inside the circle (or a deliberate foul inside the 23 m area) gives a penalty corner: the ball is pushed out from the backline, five defenders behind the goal line, the rest at halfway, and the shot must be stopped outside the circle first.',
          'A foul that stops a certain goal is a penalty stroke from 6.4 m, one on one with the goalkeeper.',
          'Cards: green (2 minutes off), yellow (5–10 minutes), red (sent off).',
        ] },
        KNOCKOUT_TIE('a shoot-out — five one-on-one runs from the 23 m line, 8 seconds each, then sudden death'),
      ],
    },
  },
  {
    key: 'handball', name: 'Handball', group: 'Team', kind: 'MATCH', teamSize: 7, scoring: single('Goals', 'Penalty throws'),
    slotMin: 45, venue: 'Court', categories: BG, olympic: true,
    rules: {
      summary: 'Seven a side on a 40 × 20 m court. Three steps, three seconds, no entering the 6 m goal area.',
      diagram: 'handball',
      sections: [
        { title: 'The game', points: [
          'Six court players and a goalkeeper; unlimited rolling substitutions. Two halves of 30 minutes (school: 20).',
          'The goal area (6 m) belongs to the goalkeeper — attackers may jump over it but must release the ball before landing. Goal 3 × 2 m.',
        ] },
        { title: 'Handling', points: [
          'Up to three steps with the ball, hold it for at most three seconds, then pass, shoot or dribble. Dribble, catch, and you may not dribble again.',
          'Playing the ball below the knee, or holding, pushing, hitting an opponent, is a free throw from the 9 m line.',
          'A foul that stops a clear scoring chance is a 7 m penalty throw.',
        ] },
        { title: 'Discipline', points: [
          'Progressive punishment: warning (yellow), 2-minute suspension, a third suspension is disqualification (red).',
          'Passive play (keeping the ball without trying to attack) — the referee raises a hand and the team must shoot within six passes.',
        ] },
        KNOCKOUT_TIE('five 7 m throws each, then sudden death'),
      ],
    },
  },
  {
    key: 'kabaddi', name: 'Kabaddi', group: 'Team', kind: 'MATCH', teamSize: 7, scoring: single('Points', 'Golden raid'),
    slotMin: 45, venue: 'Court', categories: BG, olympic: false,
    rules: {
      summary: 'Seven a side. A raider crosses into the defence chanting "kabaddi", touches defenders and returns in 30 seconds. Each defender touched is a point.',
      diagram: 'kabaddi',
      sections: [
        { title: 'The court', points: [
          'Court 13 × 10 m for boys, 12 × 8 m for girls (sub-junior 11 × 8), split by the mid line. Each half has a baulk line and a bonus line.',
          'The lobbies (1 m strips down each side) are out of bounds until the raider touches a defender; then they are part of the court for that raid.',
          'Seven on court, up to five substitutes. Two halves of 20 minutes (school: 15) with a 5-minute break; teams change halves.',
        ] },
        { title: 'The raid', points: [
          'A raid lasts 30 seconds. The raider must chant "kabaddi… kabaddi…" without a break and must cross the baulk line, else the raid fails and the raider is out.',
          'Every defender the raider touches before returning to their half is out — one point each. Crossing the bonus line with one foot in the air (six or more defenders on court) is a bonus point.',
          'If the defenders hold the raider in their half until the chant breaks, the raider is out: one point to the defence; a super tackle (three or fewer defenders) scores two.',
        ] },
        { title: 'Revival and all-out', points: [
          'Players out come back in the order they went out, one for every point their team scores.',
          'Putting the whole opposing team out is an all-out: two extra points, and all seven return.',
          'After two empty raids in a row the third is do-or-die: the raider must score or is out.',
        ] },
        KNOCKOUT_TIE('a golden raid each (baulk line becomes the bonus line); still level, repeat'),
      ],
    },
  },
  {
    key: 'kho-kho', name: 'Kho-Kho', group: 'Team', kind: 'MATCH', teamSize: 9, scoring: single('Points', 'Minimum chase'),
    slotMin: 40, venue: 'Field', categories: BG, olympic: false,
    rules: {
      summary: 'Nine a side. Chasers sit in the central lane facing alternate ways; one active chaser hunts three runners at a time. A point for every runner out.',
      diagram: 'khokho',
      sections: [
        { title: 'The field', points: [
          'Field 27 × 16 m with a pole at each end of the central lane; eight cross lanes between the poles.',
          'Nine on the field from a squad of twelve. Two innings; in each inning a team chases for one turn and runs for one turn: 9 minutes a turn (7 for sub-junior and junior).',
        ] },
        { title: 'Chasing', points: [
          'Eight chasers sit in the central lane squares, adjacent chasers facing opposite ways. The ninth is the active chaser.',
          'The active chaser may not cross the central lane except around a pole, and may not turn back once moving in a direction — to change direction, give a "kho": touch a seated chaser\'s back by hand and say "kho". That chaser gets up and continues; the giver sits in the empty square.',
          'One chaser per side may be a wazir in the new rules, allowed to change direction; the desk records the version played in the event notes.',
        ] },
        { title: 'Running and scoring', points: [
          'Runners enter in batches of three. A runner is out when touched by the active chaser\'s hand, when they go out of the field, or when they enter the field late.',
          'When all three are out the next batch enters at once. Each runner out is a point for the chasing team; a runner surviving a full 4-minute dream run earns a bonus for the runners under the 2023 rules.',
          'Most points after both innings wins. Level: an extra minimum-chase turn — whoever gets a point in the shortest time wins.',
        ] },
      ],
    },
  },
  {
    key: 'cricket', name: 'Cricket', group: 'Team', kind: 'MATCH', teamSize: 11, scoring: single('Runs', 'Super over'),
    slotMin: 120, venue: 'Ground', categories: BG, olympic: true,
    rules: {
      summary: 'Limited overs: each side bats once for a fixed number of overs. Most runs wins; a tie goes to a super over.',
      diagram: 'cricket',
      sections: [
        { title: 'The format', points: [
          'Eleven a side, one innings each of a fixed number of overs — school: 10, 15 or 20. Set it in the event notes; the slot length follows.',
          'A bowler may bowl at most a fifth of the overs (4 in a 20-over game, 2 in a 10-over game). Overs alternate ends.',
          'Runs: run between the wickets, four if the ball crosses the boundary after bouncing, six if it clears it on the full.',
        ] },
        { title: 'Extras', points: [
          'Wide: the ball passes out of the batter\'s reach — one run, re-bowled. No-ball: front foot fully over the popping crease, or a full toss above the waist, or more than one bouncer above the shoulder — one run, re-bowled, and the next ball is a free hit (only run-out can dismiss).',
          'Byes and leg-byes are runs scored without the bat and count to the team, not the batter.',
        ] },
        { title: 'Dismissals', points: [
          'Bowled, caught, run out, stumped, hit wicket, and leg before wicket (LBW).',
          'LBW: the ball pitches in line with the stumps or on the off side, hits the pad in line with the stumps (or outside off when the batter offers no shot), and would have gone on to hit the stumps. A ball pitching outside leg stump is never LBW.',
          'A batter who is out leaves; ten wickets end the innings.',
        ] },
        KNOCKOUT_TIE('a super over — one over each, most runs wins; still level, wickets lost decide'),
      ],
    },
  },
  {
    key: 'throwball', name: 'Throwball', group: 'Team', kind: 'MATCH', teamSize: 7, scoring: games('Sets', 3, 15, 2),
    slotMin: 30, venue: 'Court', categories: BG, olympic: false,
    rules: {
      summary: 'Seven a side over a 2.2 m net. Catch the ball cleanly and throw it back within three seconds. Sets to 15, best of three.',
      diagram: 'throwball',
      sections: [
        { title: 'Scoring', points: ['Rally point sets to 15, win by two, best of three sets. Change ends after each set.', 'The side winning a rally serves next.'] },
        { title: 'Playing the ball', points: [
          'The ball is caught with both hands and thrown — never hit, pushed, batted or volleyed. Release within three seconds, from above the shoulder line, standing still.',
          'Only the hands play the ball: a ball touching any other part of the body, or the ground on your side, is a point to the opponents. No player may touch the ball twice in a row.',
          'Serve from behind the end line, within five seconds of the whistle, over the net into the court.',
        ] },
        { title: 'The court', points: ['Court 12.2 × 18.3 m with a neutral box 1.5 m either side of the net; net 2.2 m (girls: 2.0 m in some events).', 'Seven on court, five substitutes; all rotate one place clockwise when they win the serve back.'] },
      ],
    },
  },
  // Combat
  {
    key: 'boxing', name: 'Boxing', group: 'Combat', kind: 'MATCH', teamSize: 1, scoring: single('Judges for', 'Referee decision'),
    slotMin: 15, venue: 'Ring', categories: BG, olympic: true,
    rules: {
      summary: 'Three rounds; judges score each round 10-9 to the better boxer. Headguards, gumshields and 10 oz gloves for youth. Weight categories.',
      diagram: 'ring',
      sections: [
        { title: 'Bouts', points: [
          'Youth: three rounds of 2 minutes (schoolboys and girls: 3 × 1.5 minutes) with a minute\'s rest. Boxers must be within the same weight category and age group; medical check before every bout.',
          'Headguard, gumshield, hand wraps and 10 oz gloves are compulsory for youth. Groin guard for boys, chest guard for girls.',
          'Ring 6.1 m inside the ropes (4.9 m acceptable for school).',
        ] },
        { title: 'Scoring', points: [
          'Each judge gives the round 10 points to the better boxer and 9 (or fewer) to the other. Judges are scored for quality punches to the front of the head and body, domination and technique.',
          'Winner by the most judges\' cards (unanimous or split). On the desk, record how many judges favoured each boxer.',
          'A bout also ends by stoppage: the referee stops it for safety, a third standing count in a round (youth), or the corner retiring the boxer.',
        ] },
        { title: 'Fouls', points: ['Hitting below the belt, on the back of the head or back, with the open glove, inside of the glove or wrist; holding, wrestling, headbutts, hitting a boxer who is down.', 'Warnings deduct a point; a third warning disqualifies.'] },
      ],
    },
  },
  {
    key: 'judo', name: 'Judo', group: 'Combat', kind: 'MATCH', teamSize: 1, scoring: single('Score', 'Golden score'),
    slotMin: 10, venue: 'Mat', categories: BG, olympic: true,
    rules: {
      summary: 'Ippon ends the contest — a clean throw onto the back, a 20-second hold, or a submission. Two waza-ari make an ippon.',
      diagram: 'mat',
      sections: [
        { title: 'Winning', points: [
          'Ippon (10): a throw landing the opponent largely on the back with force, speed and control; holding down for 20 seconds; a submission by armlock or strangle (no strangles or armlocks for under-15).',
          'Waza-ari (1): a throw missing one element of ippon, or a hold of 10–19 seconds. Two waza-ari = ippon.',
          'Contests last 4 minutes (cadets 3; school 3). If level at time, golden score: no time limit, first score or the opponent\'s third shido wins.',
        ] },
        { title: 'Penalties', points: [
          'Shido for passivity, stepping out, false attacks, defensive posture, grabbing the leg with the hand. Three shidos = hansoku-make (loss).',
          'Direct hansoku-make for a dangerous act — diving head first, locking a joint other than the elbow.',
        ] },
        { title: 'The mat', points: ['Contest area 8 × 8 m (6 × 6 minimum) with a safety area around it. A throw begun inside and landing outside still counts.', 'White judogi for the first-called, blue (or a red belt) for the second.'] },
      ],
    },
  },
  {
    key: 'taekwondo', name: 'Taekwondo', group: 'Combat', kind: 'MATCH', teamSize: 1, scoring: single('Points', 'Golden point'),
    slotMin: 15, venue: 'Mat', categories: BG, olympic: true,
    rules: {
      summary: 'Three rounds of kicks and punches to the scoring zones: body 2, head 3, turning kicks 4 and 5. A tied bout goes to a golden point.',
      diagram: 'mat',
      sections: [
        { title: 'Scoring', points: [
          'Punch to the trunk 1 point; kick to the trunk 2; kick to the head 3; turning kick to the trunk 4; turning kick to the head 5.',
          'A gam-jeom (penalty) gives one point to the opponent; ten gam-jeom lose the bout. A 20-point lead at the end of round two ends the bout.',
          'Three rounds of 2 minutes with 1 minute rest (cadets 3 × 1.5). Level after three: a golden-point round — first score wins; still level, the referees decide on superiority.',
        ] },
        { title: 'Penalties', points: ['Crossing the boundary, falling, avoiding or delaying, grabbing or pushing, attacking below the waist, attacking a fallen opponent, attacking the face with the hand.'] },
        { title: 'Equipment and area', points: ['Octagonal contest area 8 m across. Trunk protector (hogu), head protector, groin guard, forearm and shin guards, mouthguard and gloves are compulsory; sensor socks where electronic scoring is used.'] },
      ],
    },
  },
  {
    key: 'wrestling', name: 'Wrestling', group: 'Combat', kind: 'MATCH', teamSize: 1, scoring: single('Points', 'Criteria'),
    slotMin: 15, venue: 'Mat', categories: BG, olympic: true,
    rules: {
      summary: 'Freestyle: two periods of 3 minutes. Win by fall, by a 10-point lead, or on points. Takedown 2, exposure 2, reversal 1, step-out 1.',
      diagram: 'mat',
      sections: [
        { title: 'Winning', points: [
          'Fall: both of the opponent\'s shoulders held on the mat — the contest ends at once.',
          'Technical superiority: a 10-point lead in freestyle (8 in Greco-Roman) ends the bout.',
          'Otherwise most points after two periods of 3 minutes (cadets 2 × 2) with a 30-second break.',
        ] },
        { title: 'Points', points: [
          'Takedown 2 (4 if the opponent lands in a danger position); exposing the opponent\'s back to the mat 2; reversal 1; pushing the opponent out of the circle 1.',
          'Passivity: a warning, then a 30-second shot clock — fail to score and the opponent gets a point.',
          'Level on points: most higher-value moves, then fewest cautions, then whoever scored last.',
        ] },
        { title: 'The mat', points: ['A 9 m circle with a 1 m orange passivity zone at the edge. Illegal: punching, kicking, headbutting, twisting fingers, holds against the joints, grabbing the singlet.'] },
      ],
    },
  },
  {
    key: 'karate', name: 'Karate (kumite)', group: 'Combat', kind: 'MATCH', teamSize: 1, scoring: single('Points', 'Hantei'),
    slotMin: 10, venue: 'Mat', categories: BG, olympic: true,
    rules: {
      summary: 'Controlled sparring: yuko 1, waza-ari 2, ippon 3. An eight-point lead ends the bout; a level bout goes to the first scorer, then the judges.',
      diagram: 'mat',
      sections: [
        { title: 'Scoring', points: [
          'Yuko (1): a punch to the body or head. Waza-ari (2): a kick to the body. Ippon (3): a kick to the head, or any technique on a thrown or fallen opponent.',
          'Bouts: 3 minutes senior, 2 minutes cadets and juniors. An eight-point lead wins at once; otherwise most points at time.',
          'Level: the fighter who scored the first unopposed point (senshu) wins; if nobody holds senshu, the judges decide by hantei.',
        ] },
        { title: 'Control and penalties', points: [
          'Contact must be controlled: excessive contact to the head, attacks below the belt, throat, joints or groin, grabbing, and stepping out draw category warnings — chukoku, keikoku, hansoku-chui, then hansoku (disqualification).',
          'Mat 8 × 8 m with a 1 m safety area. Mitts, gumshield, body protector, shin and instep pads are compulsory for cadets and juniors.',
        ] },
      ],
    },
  },
  {
    key: 'fencing', name: 'Fencing', group: 'Combat', kind: 'MATCH', teamSize: 1, scoring: single('Touches', 'Priority minute'),
    slotMin: 15, venue: 'Piste', categories: BG, olympic: true,
    rules: {
      summary: 'Pool bouts to 5 touches in 3 minutes; direct elimination to 15 in three 3-minute periods. Foil and sabre use right of way; épée does not.',
      diagram: 'mat',
      sections: [
        { title: 'Scoring', points: [
          'Pools: first to 5 touches or most touches after 3 minutes. Direct elimination: first to 15, or most after 3 × 3 minutes with 1-minute breaks.',
          'Level at time: one minute of sudden death; priority is drawn beforehand and wins if nobody scores.',
        ] },
        { title: 'Weapons', points: [
          'Foil: target is the torso only; hits with the point; right of way — the fencer who attacks first scores unless parried.',
          'Épée: whole body is target; point only; no right of way — both may score at once (double touch).',
          'Sabre: target above the waist; cuts and point; right of way applies.',
        ] },
        { title: 'The piste', points: ['Piste 14 m long, 1.5–2 m wide. Stepping off the end with both feet gives the opponent a touch; stepping off the side stops the bout and loses a metre.', 'Mask, jacket, plastron, glove and (for foil and sabre) the conductive lamé are compulsory.'] },
      ],
    },
  },
  // Precision
  {
    key: 'archery', name: 'Archery', group: 'Precision', kind: 'MEASURED', teamSize: 1, scoring: points('Score', 0),
    slotMin: 30, lanes: 4, venue: 'Range', categories: BG, olympic: true,
    rules: {
      summary: 'A ranking round of arrows at a ten-ring target; highest total wins. School: 30 m outdoor or 18 m indoor.',
      diagram: 'target',
      sections: [
        { title: 'The target', points: [
          'Ten concentric rings scoring 10 (gold centre) down to 1 (outer white). An arrow cutting a line scores the higher ring.',
          'Olympic distance is 70 m on a 122 cm face. School: 30 m on an 80 cm face, or 18 m indoor on a 40 cm face.',
        ] },
        { title: 'Shooting', points: [
          'Arrows are shot in ends of 6 (outdoor, 4 minutes) or 3 (indoor, 2 minutes). A ranking round is 72 arrows in senior events; school rounds of 30 or 36 are common.',
          'Nobody goes forward to the targets until the line officer signals; arrows are scored and pulled together.',
          'An arrow shot after the time signal loses the highest-scoring arrow of that end. Rebounds and pass-throughs are scored by the mark they leave.',
        ] },
        { title: 'Head-to-head (finals)', points: ['Olympic matches use the set system: 3 arrows a set, 2 set points for the higher score, 1 each for a tie, first to 6 set points; level at 5-5 goes to a one-arrow shoot-off closest to the centre.'] },
      ],
    },
  },
  {
    key: 'shooting-air-rifle', name: 'Shooting (10 m air rifle)', group: 'Precision', kind: 'MEASURED', teamSize: 1, scoring: points('Score', 1),
    slotMin: 60, lanes: 6, venue: 'Range', categories: BG, olympic: true,
    rules: {
      summary: 'Standing, 10 m, a series of shots at a tiny ten-ring target scored in tenths. Highest total wins. Safety first, always.',
      diagram: 'target',
      sections: [
        { title: 'The match', points: [
          'Olympic: 60 shots in 75 minutes (school: 30 or 40 shots). Air rifle scores in tenths — 10.9 is a perfect shot; air pistol scores whole rings in qualification.',
          'Unlimited sighting shots before the match begins; none once "Start" is called.',
          'Rifle at most 5.5 kg with a 4.5 mm pellet; shooting jacket, trousers and glove within the rules.',
        ] },
        { title: 'Safety and conduct', points: [
          'Muzzle points downrange at all times. A safety flag stays in the breech whenever the rifle is not on the firing line. Nobody handles a rifle while anyone is forward of the line.',
          'Follow every range officer command at once: "Load", "Start", "Stop", "Unload". A shot after "Stop" is scored as a miss and a warning.',
        ] },
      ],
    },
  },
  // Mind
  {
    key: 'chess', name: 'Chess', group: 'Mind', kind: 'MATCH', teamSize: 1, scoring: single('Wins', 'Blitz decider'),
    slotMin: 60, venue: 'Board', categories: ALL, olympic: false,
    rules: {
      summary: 'A knockout tie is two games with colours swapped; wins count, draws do not. Level after two goes to a blitz decider.',
      diagram: 'chess',
      sections: [
        { title: 'The match', points: [
          'Two games per tie, one with each colour. Score a game as a win or nothing; a draw is nothing to either side. Level (1-1 or 0-0) goes to a blitz decider (3 minutes + 2 seconds), then armageddon.',
          'School time control: 15 minutes each plus 10 seconds a move (rapid). Set it in the event notes.',
        ] },
        { title: 'Playing', points: [
          'Touch-move: touch a piece with intent and you must move it; touch an opponent\'s piece and you must capture it if you legally can. Say "j\'adoube" (I adjust) before straightening a piece.',
          'Checkmate wins. Stalemate, threefold repetition, the fifty-move rule, insufficient material and agreement are draws.',
          'Illegal move in rapid: the first costs 2 minutes to the opponent; the second loses the game.',
          'Castling: king and rook unmoved, no pieces between, the king not in check and not passing through or landing on an attacked square. A pawn reaching the last rank must promote; en passant only on the very next move.',
        ] },
        { title: 'Conduct', points: ['Press the clock with the hand that moved. No talking, no phones at the board — a phone ringing loses the game. Recording moves is required in classical games only, not in rapid or blitz.'] },
      ],
    },
  },
  {
    key: 'carrom', name: 'Carrom', group: 'Mind', kind: 'MATCH', teamSize: 1, scoring: single('Points', 'Extra board'),
    slotMin: 30, venue: 'Board', categories: ALL, olympic: false,
    rules: {
      summary: 'Pocket your nine coins and cover the queen. A game is 25 points or eight boards; points come from the coins your opponent has left.',
      diagram: 'carrom',
      sections: [
        { title: 'The game', points: [
          'Nine white, nine black and the red queen. The breaker plays white. Strike from your baseline with the striker (at most 15 g); the striker must touch both baselines or the arrow when placed.',
          'A board ends when one player has pocketed all their coins. The winner scores one point for each opponent coin still on the board, plus three for the queen if they covered her — unless their score is 22 or more.',
          'A game is the first to 25 points, or the higher score after eight boards.',
        ] },
        { title: 'The queen', points: [
          'The queen may be pocketed only after you have pocketed at least one of your own coins, and must be covered by pocketing one of your coins in the same stroke or your very next one; otherwise she comes back to the centre.',
          'Pocket the queen and your last coin in the same stroke and the queen counts as covered.',
        ] },
        { title: 'Fouls', points: [
          'Pocketing the striker: one of your pocketed coins comes back (a due), and the turn passes. Pocketing an opponent\'s coin gives it to them.',
          'Touching a coin with the hand, striking out of turn, or a coin leaving the board — the coin is placed back at the centre by the opponent.',
        ] },
      ],
    },
  },
  // Fitness and others
  {
    key: 'gymnastics', name: 'Gymnastics (artistic)', group: 'Fitness', kind: 'JUDGED', teamSize: 1, scoring: points('Score', 2),
    slotMin: 60, lanes: 10, venue: 'Hall', categories: BG, olympic: true,
    rules: {
      summary: 'Floor and vault (plus bars, beam, rings and pommel at higher levels). Score = difficulty + execution − penalties.',
      sections: [
        { title: 'Scoring', points: [
          'D score: the difficulty of the elements performed and their connections. E score: execution, starting from 10.0 with deductions for bent legs, flexed feet, steps and wobbles.',
          'A fall is a 1.0 deduction; stepping out of the floor area or exceeding the time limit (girls 90 s, boys 70 s) is a penalty.',
          'Final = D + E − penalties. Ties share the place.',
        ] },
        { title: 'School events', points: ['Most school meets judge floor and vault only, each out of 10 by a panel of three; the desk records the panel average with two decimals.', 'Spotters and mats are compulsory; no element is attempted in competition that was not trained with a coach.'] },
      ],
    },
  },
  {
    key: 'yoga', name: 'Yogasana', group: 'Fitness', kind: 'JUDGED', teamSize: 1, scoring: points('Score', 1),
    slotMin: 45, lanes: 10, venue: 'Hall', categories: BG, olympic: false,
    rules: {
      summary: 'Compulsory and optional asanas judged on the final posture, balance, holding time and breathing. Highest total wins.',
      sections: [
        { title: 'The event', points: [
          'A set of compulsory asanas for the age group plus one or two chosen ones. Each asana is held for the required time — 10 to 30 seconds by level — while the panel marks.',
          'Marks out of 10 per asana for precision of the final posture, steadiness, holding time, breathing and the smoothness of getting in and out.',
          'Deductions for wobbling, touching the floor for support, breaking the hold early, or an incorrect final position.',
        ] },
        { title: 'Conduct', points: ['Bare feet on the mat, plain fitted clothing, no music unless the format says so. Judges sit in front; the athlete faces them.'] },
      ],
    },
  },
  {
    key: 'weightlifting', name: 'Weightlifting', group: 'Fitness', kind: 'MEASURED', teamSize: 1,
    scoring: { type: 'MARK', label: 'Total', unit: 'kg', lowerIsBetter: false, precision: 0 },
    slotMin: 60, lanes: 10, venue: 'Platform', categories: BG, olympic: true,
    rules: {
      summary: 'Snatch then clean and jerk, three attempts each. Total = best snatch + best clean and jerk, within a bodyweight category.',
      sections: [
        { title: 'The lifts', points: [
          'Snatch: bar from floor to overhead in one movement. Clean and jerk: to the shoulders, then overhead. Three attempts at each; the bar may not go down between attempts.',
          'A good lift: bar motionless overhead, arms and legs locked, feet in line, wait for the referees\' signal. Press-out, elbow touching the knee, or dropping the bar from above the shoulders is a no-lift.',
          'One minute to start an attempt (two when the same lifter follows themself).',
        ] },
        { title: 'Ranking and youth', points: [
          'Rank by total. Equal totals: the lifter who reached it first wins.',
          'Youth events start at 13. School practice: a light bar, technique before load, no maximal attempts without a qualified coach.',
        ] },
      ],
    },
  },
  {
    key: 'cycling-tt', name: 'Cycling (time trial)', group: 'Fitness', kind: 'MEASURED', teamSize: 1, scoring: time('Time'),
    slotMin: 30, lanes: 1, venue: 'Course', categories: BG, olympic: true,
    rules: {
      summary: 'Riders start alone at intervals and race the clock over a closed course. No drafting. Fastest time wins.',
      sections: [
        { title: 'The race', points: [
          'Riders start 30 seconds or a minute apart from a standing start. Time runs from the start signal until the front wheel crosses the line.',
          'No drafting: stay at least 25 m behind a rider ahead, or pass cleanly. Slipstreaming is a time penalty, then disqualification.',
          'School: 1–5 km on a closed loop with marshals at every turn; helmet compulsory, bike checked before the start.',
        ] },
      ],
    },
  },
  {
    key: 'skating-500m', name: 'Speed skating (500 m)', group: 'Fitness', kind: 'MEASURED', teamSize: 1, scoring: time('Time'),
    slotMin: 5, lanes: 4, venue: 'Rink', categories: BG, olympic: false,
    rules: {
      summary: 'Inline skating on a 200 m rink, four to six per heat. No pushing or cutting in; the fastest times reach the final.',
      sections: [
        { title: 'The race', points: [
          'Heats of four to six skaters on a 200 m track. Fastest times across the heats go to the final; the final is placed on the line.',
          'No pushing, holding, or cutting inside another skater without a clear lead. A false start is one warning, then disqualification.',
          'Helmet, wrist guards, knee and elbow pads are compulsory.',
        ] },
      ],
    },
  },
  {
    key: 'rope-skipping', name: 'Rope skipping (30 s speed)', group: 'Fitness', kind: 'MEASURED', teamSize: 1,
    scoring: { type: 'MARK', label: 'Jumps', unit: 'reps', lowerIsBetter: false, precision: 0 },
    slotMin: 10, lanes: 10, venue: 'Hall', categories: ALL, olympic: false,
    rules: {
      summary: 'Thirty seconds, single rope, as many jumps as you can. A miss stops the count only while the rope is stopped.',
      sections: [
        { title: 'The event', points: [
          'Single rope, 30 seconds from the whistle. A judge counts every jump (official speed events count right-foot steps and double the number; school counts every jump — say which in the event notes).',
          'A miss (rope catches) does not end the attempt; restart at once and the count continues.',
          'One attempt per competitor; highest count wins, and a tie shares the place.',
        ] },
      ],
    },
  },
];

// ── custom sports ──────────────────────────────────────────────
export const CUSTOM_PREFIX = 'custom:';

export interface ScoringPreset { key: string; label: string; kind: SportKind; scoring: Scoring; slotMin: number; lanes?: number }
export const SCORING_PRESETS: readonly ScoringPreset[] = [
  { key: 'games-21', label: 'Games to 21, best of 3 (badminton style)', kind: 'MATCH', scoring: games('Games', 3, 21, 2, 30), slotMin: 25 },
  { key: 'games-11', label: 'Games to 11, best of 5 (table tennis style)', kind: 'MATCH', scoring: games('Games', 5, 11, 2), slotMin: 20 },
  { key: 'sets-25', label: 'Sets to 25, best of 3 (volleyball style)', kind: 'MATCH', scoring: games('Sets', 3, 25, 2, undefined, 15), slotMin: 45 },
  { key: 'goals', label: 'Goals, penalties if level', kind: 'MATCH', scoring: single('Goals', 'Penalties'), slotMin: 45 },
  { key: 'points', label: 'Points, extra time if level', kind: 'MATCH', scoring: single('Points', 'Extra period'), slotMin: 30 },
  { key: 'time', label: 'Fastest time', kind: 'MEASURED', scoring: time('Time'), slotMin: 5, lanes: 6 },
  { key: 'distance', label: 'Longest distance', kind: 'MEASURED', scoring: distance('Distance'), slotMin: 30, lanes: 12 },
  { key: 'count', label: 'Highest count', kind: 'MEASURED', scoring: { type: 'MARK', label: 'Count', unit: 'reps', lowerIsBetter: false, precision: 0 }, slotMin: 10, lanes: 10 },
  { key: 'judged', label: 'Judged out of 10', kind: 'JUDGED', scoring: points('Score', 1), slotMin: 45, lanes: 10 },
];

/**
 * A school's own sport (e.g. "Tug of war"). The key carries everything needed
 * to score it later — `custom:<preset>:<teamSize>:<slug>` — so no extra
 * column is needed. Measured and judged presets are individual only (a mark
 * belongs to one student), so `teamSize` is forced to 1 for them.
 */
export function customSport(name: string, presetKey: string, teamSize = 1, venueType?: VenueType): Sport | null {
  const preset = SCORING_PRESETS.find((p) => p.key === presetKey);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!preset || !slug) return null;
  if (preset.kind !== 'MATCH') teamSize = 1;
  teamSize = Math.min(Math.max(1, Math.floor(teamSize)), 20);
  return {
    key: `${CUSTOM_PREFIX}${preset.key}:${teamSize}:${venueType ? `${venueType}:` : ''}${slug}`, name: name.trim(), group: teamSize > 1 ? 'Team' : 'Fitness', kind: preset.kind, teamSize,
    scoring: preset.scoring, slotMin: preset.slotMin, ...(preset.lanes ? { lanes: preset.lanes } : {}),
    venue: venueType ? VENUE_TYPE_LABEL[venueType] : 'Hall', categories: ALL, olympic: false,
    rules: { summary: `${name.trim()} — a sport this school added. Scored as: ${preset.label.toLowerCase()}.`, sections: [] },
  };
}

// ── lookups ───────────────────────────────────────────────────
const BY_KEY = new Map(SPORTS.map((s) => [s.key, s]));

export function sportByKey(key: string): Sport | undefined { return BY_KEY.get(key); }

/** Catalogue sport, or a custom one rebuilt from its key (the stored name wins over the slug). */
export function resolveSport(key: string, name?: string): Sport | undefined {
  const known = BY_KEY.get(key);
  if (known) return known;
  const m = /^custom:([a-z0-9-]+):(\d+):(?:([a-z]+):)?([a-z0-9-]+)$/.exec(key);
  if (!m) return undefined;
  const vt = m[3] && (VENUE_TYPES as readonly string[]).includes(m[3]) ? (m[3] as VenueType) : undefined;
  return customSport(name?.trim() || m[4].replace(/-/g, ' '), m[1], Number(m[2]), vt) ?? undefined;
}
export function isCustomSportKey(key: string): boolean { return key.startsWith(CUSTOM_PREFIX); }

export function sportsByGroup(): { group: SportGroup; sports: Sport[] }[] {
  return SPORT_GROUPS.map((group) => ({ group, sports: SPORTS.filter((s) => s.group === group) })).filter((g) => g.sports.length > 0);
}

/** A sport's sides are sections when it is a team sport, students otherwise. */
export function sidesAreSections(sport: Pick<Sport, 'teamSize'>): boolean { return sport.teamSize > 1; }

// ── venues ────────────────────────────────────────────────────
/** The kinds of place a school names when it sets up a meet. A venue's type is read from its name and can be changed. */
export const VENUE_TYPES = ['court', 'table', 'field', 'track', 'pool', 'hall', 'board', 'mat', 'ring', 'range'] as const;
export type VenueType = (typeof VENUE_TYPES)[number];
export const VENUE_TYPE_LABEL: Record<VenueType, string> = { court: 'Court', table: 'Table', field: 'Field', track: 'Track', pool: 'Pool', hall: 'Hall', board: 'Board', mat: 'Mat', ring: 'Ring', range: 'Range' };

const VENUE_WORD_TYPE: Record<string, VenueType> = {
  Court: 'court', Table: 'table', Field: 'field', Ground: 'field', Pit: 'field', Circle: 'field', Runway: 'field', Course: 'field', Rink: 'field',
  Track: 'track', Pool: 'pool', Hall: 'hall', Platform: 'hall', Piste: 'hall', Board: 'board', Mat: 'mat', Ring: 'ring', Range: 'range', Venue: 'hall',
};
/** Where a sport with no venue of its own type can still run. */
export const VENUE_FALLBACK: Partial<Record<VenueType, VenueType>> = { board: 'hall', mat: 'hall', ring: 'hall', table: 'hall', range: 'field' };

/** The type of place a sport is played on. */
export function venueTypeOf(sport: Pick<Sport, 'venue'>): VenueType {
  return VENUE_WORD_TYPE[sport.venue] ?? 'hall';
}

const NAME_TYPE: [RegExp, VenueType][] = [
  [/\bcourts?\b/i, 'court'], [/\btables?\b/i, 'table'], [/\b(field|ground|pitch|lawn|oval)\b/i, 'field'], [/\btrack\b/i, 'track'], [/\bpool\b/i, 'pool'],
  [/\b(hall|auditorium|gym|gymnasium|indoor)\b/i, 'hall'], [/\bboards?\b/i, 'board'], [/\b(mat|dojo|mats)\b/i, 'mat'], [/\bring\b/i, 'ring'], [/\brange\b/i, 'range'],
];
/** "Court 1" → court, "Football ground" → field, "TT table" → table; anything else is a hall. */
export function inferVenueType(name: string): VenueType {
  for (const [re, t] of NAME_TYPE) if (re.test(name)) return t;
  return 'hall';
}

/** The sport a venue is named after ("Badminton court 3" → badminton), if any. */
export function sportNamedIn(venueName: string): Sport | undefined {
  const n = venueName.toLowerCase();
  return SPORTS.find((s) => {
    const first = s.name.toLowerCase().split(/[\s(]/)[0];
    return first.length >= 4 && /[a-z]/.test(first) && n.includes(first);
  });
}

export interface VenueLike { name: string; type: VenueType }
export interface VenueMatch<V extends VenueLike> { list: V[]; how: 'named' | 'type' | 'fallback' | 'none'; want: VenueType }
/**
 * Which of a meet's venues an event should take by default:
 *   1. venues NAMED after the sport ("Badminton court 3"), and only those;
 *   2. else every venue of the sport's type that is not named after another sport;
 *   3. else the fallback type (a board game in the hall);
 *   4. else none — never every venue.
 */
export function venuesForSport<V extends VenueLike>(sport: Pick<Sport, 'key' | 'name' | 'venue'>, venues: V[]): VenueMatch<V> {
  const want = venueTypeOf(sport);
  const named = venues.filter((v) => sportNamedIn(v.name)?.key === sport.key);
  if (named.length) return { list: named, how: 'named', want };
  const generic = venues.filter((v) => v.type === want && !sportNamedIn(v.name));
  if (generic.length) return { list: generic, how: 'type', want };
  const fb = VENUE_FALLBACK[want];
  const fallback = fb ? venues.filter((v) => v.type === fb && !sportNamedIn(v.name)) : [];
  return { list: fallback, how: fallback.length ? 'fallback' : 'none', want };
}
