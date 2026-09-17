import Svg, { Path } from 'react-native-svg';

/**
 * DUOTONE GLYPHS.
 *
 * Ionicons carried us this far but has no duotone variant, and a single hairline
 * stroke on a hairline circle gave two thin greys with nothing between them —
 * which is why the drawer read as faint. Icon guidance is consistent: a bolder
 * glyph wants roughly a 2px stroke, and a two-layer (filled body under stroke)
 * treatment is what keeps it legible against any background and gives it depth.
 *
 * Both layers are driven by ONE colour. The body fills at 20% and the detail
 * strokes at full, so a caller passes a single hue and gets a coherent icon —
 * which is what lets a school's brand reach these without a second token.
 */
export type IconName =
  | 'take'
  | 'assignments'
  | 'messages'
  | 'diary'
  | 'notices'
  | 'timetable'
  | 'results'
  | 'requests'
  | 'holidays'
  | 'notes'
  | 'home'
  | 'person'
  // Second edition — the six new screens, and the three glyphs the chrome
  // drew through Ionicons until the tab bar moved to this set.
  | 'fees'
  | 'sports'
  | 'library'
  | 'cake'
  | 'report'
  | 'bell'
  | 'chevron'
  | 'offline'
  // The glyphs the last emoji were standing in for.
  | 'pin'
  | 'send'
  | 'mail'
  | 'phone'
  | 'palette'
  | 'key';

/** `body` is the filled silhouette; `lines` are the strokes drawn over it. */
const PATHS: Record<IconName, { body: string; lines: string[] }> = {
  take: {
    body: 'M5.5 6.5A1 1 0 0 1 6.5 5.5h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z',
    lines: [
      'M5.5 6.5A1 1 0 0 1 6.5 5.5h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z',
      'm8.8 12 2.3 2.3 4.3-4.6',
    ],
  },
  assignments: {
    body: 'M4 8.2 12 4.6l8 3.6-8 3.7Z',
    lines: ['M4 8.2 12 4.6l8 3.6-8 3.7Z', 'M4.4 12.6 12 16.1l7.6-3.5M4.4 16.4 12 19.9l7.6-3.5'],
  },
  messages: {
    body: 'M4.6 6.6A1.2 1.2 0 0 1 5.8 5.4h12.4a1.2 1.2 0 0 1 1.2 1.2v8a1.2 1.2 0 0 1-1.2 1.2H9.1l-4.5 3.3Z',
    lines: [
      'M4.6 6.6A1.2 1.2 0 0 1 5.8 5.4h12.4a1.2 1.2 0 0 1 1.2 1.2v8a1.2 1.2 0 0 1-1.2 1.2H9.1l-4.5 3.3Z',
      'M8.2 9.1h7.6M8.2 12.1h4.6',
    ],
  },
  diary: {
    body: 'M6 4.2h11.4a1 1 0 0 1 1 1v13.6a1 1 0 0 1-1 1H6Z',
    lines: ['M6 4.2h11.4a1 1 0 0 1 1 1v13.6a1 1 0 0 1-1 1H6Z', 'M6 4.2v15.6M9.6 8.6h5.2M9.6 12.4h3.4'],
  },
  notices: {
    body: 'M5 10.2v3.6a1 1 0 0 0 1 1h2.6l6.4 3.9V5.3L8.6 9.2H6a1 1 0 0 0-1 1Z',
    lines: ['M5 10.2v3.6a1 1 0 0 0 1 1h2.6l6.4 3.9V5.3L8.6 9.2H6a1 1 0 0 0-1 1Z', 'M18.2 9.4a4 4 0 0 1 0 5.2'],
  },
  timetable: {
    body: 'M4.6 7.8A1.2 1.2 0 0 1 5.8 6.6h12.4a1.2 1.2 0 0 1 1.2 1.2v10.6a1.2 1.2 0 0 1-1.2 1.2H5.8a1.2 1.2 0 0 1-1.2-1.2Z',
    lines: [
      'M4.6 7.8A1.2 1.2 0 0 1 5.8 6.6h12.4a1.2 1.2 0 0 1 1.2 1.2v10.6a1.2 1.2 0 0 1-1.2 1.2H5.8a1.2 1.2 0 0 1-1.2-1.2Z',
      'M4.6 10.4h14.8M8.6 4.4v3.4M15.4 4.4v3.4',
    ],
  },
  results: {
    body: 'M6.2 13.4h2.6v6H6.2ZM10.7 7.6h2.6v11.8h-2.6ZM15.2 10.4h2.6v9h-2.6Z',
    lines: ['M6.2 13.4h2.6v6H6.2ZM10.7 7.6h2.6v11.8h-2.6ZM15.2 10.4h2.6v9h-2.6Z', 'M3.8 19.6h16.4'],
  },
  requests: {
    body: 'M5.4 6.6a1.2 1.2 0 0 1 1.2-1.2h10.8a1.2 1.2 0 0 1 1.2 1.2v11.8a1.2 1.2 0 0 1-1.2 1.2H6.6a1.2 1.2 0 0 1-1.2-1.2Z',
    lines: [
      'M5.4 6.6a1.2 1.2 0 0 1 1.2-1.2h10.8a1.2 1.2 0 0 1 1.2 1.2v11.8a1.2 1.2 0 0 1-1.2 1.2H6.6a1.2 1.2 0 0 1-1.2-1.2Z',
      'M9 3.9h6v2.6H9zM8.8 11.4h6.4M8.8 14.8h4',
    ],
  },
  holidays: {
    body: 'M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z',
    lines: [
      'M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z',
      'M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18',
    ],
  },
  notes: {
    body: 'M7.6 4.4h9.4a1 1 0 0 1 1 1v13.2a1 1 0 0 1-1 1H7.6Z',
    lines: ['M7.6 4.4h9.4a1 1 0 0 1 1 1v13.2a1 1 0 0 1-1 1H7.6Z', 'M7.6 8.2H5.4M7.6 12H5.4M7.6 15.8H5.4M10.8 9.2h4'],
  },
  home: {
    body: 'M4.4 10.6 12 4.4l7.6 6.2v8.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1Z',
    lines: ['M4.4 10.6 12 4.4l7.6 6.2v8.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1Z'],
  },
  person: {
    body: 'M12 4.8a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM5.6 19.8c.7-3.5 3.2-5.4 6.4-5.4s5.7 1.9 6.4 5.4Z',
    lines: [
      'M12 4.8a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z',
      'M5.6 19.8c.7-3.5 3.2-5.4 6.4-5.4s5.7 1.9 6.4 5.4',
    ],
  },
  // A receipt with a torn foot and the rupee sign — a bill, not a coin.
  fees: {
    body: 'M6 5h12v14.6l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z',
    lines: [
      'M6 5h12v14.6l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z',
      'M9 9h6M9 12h6c0 2-1.5 3-3 3H9l4 4',
    ],
  },
  // A trophy — the meet, not a ball, because a ball picks one sport.
  sports: {
    body: 'M8 4.5h8v3a4 4 0 0 1-8 0Z',
    lines: [
      'M8 4.5h8v3a4 4 0 0 1-8 0Z',
      'M8 6H5.5a2.5 2.5 0 0 0 2.6 3M16 6h2.5a2.5 2.5 0 0 1-2.6 3M12 11.5v3.5M9 19.5h6M12 15c-1.6 0-2.5 1.5-2.5 4.5h5c0-3-.9-4.5-2.5-4.5Z',
    ],
  },
  // Three spines, one leaning — a shelf with books on it.
  library: {
    body: 'M5 5h3.5v14H5ZM10 5h3.5v14H10ZM14.6 6.2l3.3-.9 3.7 13.3-3.3.9Z',
    lines: ['M5 5h3.5v14H5ZM10 5h3.5v14H10ZM14.6 6.2l3.3-.9 3.7 13.3-3.3.9Z'],
  },
  // A cake with one candle — the birthday wall.
  cake: {
    body: 'M5 12h14v7.5H5Z',
    lines: [
      'M5 12h14v7.5H5Z',
      'M5 15c1.5 1.4 3 1.4 4.5 0s3 1.4 4.5 0 3 1.4 4.5 0M12 12V8.5M12 5.5c-.8.9-.8 1.9 0 2.6.8-.7.8-1.7 0-2.6Z',
    ],
  },
  // A sheet with a folded corner and ruled lines — the printed card.
  report: {
    body: 'M6 4.5h9l3.5 3.5v11.5H6Z',
    lines: ['M6 4.5h9l3.5 3.5v11.5H6Z', 'M15 4.5V8h3.5M9 12h6M9 15.5h4'],
  },
  // The bell the header wore as an Ionicon.
  bell: {
    body: 'M7 16V11a5 5 0 0 1 10 0v5l1.5 1.8H5.5Z',
    lines: ['M7 16V11a5 5 0 0 1 10 0v5l1.5 1.8H5.5Z', 'M10 19.5a2 2 0 0 0 4 0M12 4.2v1.8'],
  },
  // The way back. Stroke only — a chevron has no body to fill.
  chevron: {
    body: '',
    lines: ['M14.5 6 8.5 12l6 6'],
  },
  // A cloud with a line through it — no signal.
  offline: {
    body: 'M7 17.5a3.5 3.5 0 0 1-.4-7 5 5 0 0 1 9.6-1.2A3.4 3.4 0 0 1 17.5 17.5Z',
    lines: ['M7 17.5a3.5 3.5 0 0 1-.4-7 5 5 0 0 1 9.6-1.2A3.4 3.4 0 0 1 17.5 17.5Z', 'M4 4l16 16'],
  },
  // A drawing pin, head and point — a note pinned to the class page.
  pin: {
    body: 'M9 4.5h6l-1 5.5 2.5 2.5v1.5H7.5v-1.5L10 10Z',
    lines: ['M9 4.5h6l-1 5.5 2.5 2.5v1.5H7.5v-1.5L10 10Z', 'M12 14v5.5'],
  },
  // A paper plane — send.
  send: {
    body: 'M4.5 11.5 19.5 5l-4 14-4.5-5Z',
    lines: ['M4.5 11.5 19.5 5l-4 14-4.5-5Z', 'M11 14l8.5-9'],
  },
  // An envelope.
  mail: {
    body: 'M4.5 7A1.5 1.5 0 0 1 6 5.5h12A1.5 1.5 0 0 1 19.5 7v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 17Z',
    lines: ['M4.5 7A1.5 1.5 0 0 1 6 5.5h12A1.5 1.5 0 0 1 19.5 7v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 17Z', 'm5 7.5 7 5.5 7-5.5'],
  },
  // A handset.
  phone: {
    body: 'M6.5 4.5h3l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.5 1.5A14 14 0 0 1 5 6a1.5 1.5 0 0 1 1.5-1.5Z',
    lines: ['M6.5 4.5h3l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.5 1.5A14 14 0 0 1 5 6a1.5 1.5 0 0 1 1.5-1.5Z'],
  },
  // A painter's palette with three wells — appearance.
  palette: {
    body: 'M12 4.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.8 1.2-1.7-.5-1 .2-2 1.3-2H16a3.5 3.5 0 0 0 3.5-3.5A7.5 7.5 0 0 0 12 4.5Z',
    lines: ['M12 4.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.8 1.2-1.7-.5-1 .2-2 1.3-2H16a3.5 3.5 0 0 0 3.5-3.5A7.5 7.5 0 0 0 12 4.5Z', 'M8.5 12.5h.01M10.5 8.5h.01M14.5 8.5h.01'],
  },
  // A key — the password.
  key: {
    body: 'M8.5 8.5a4 4 0 1 1 3.4 5.9L10 16.3V18h-2v1.5H6.5v-2L11 13a4 4 0 0 1-2.5-4.5Z',
    lines: ['M8.5 8.5a4 4 0 1 1 3.4 5.9L10 16.3V18h-2v1.5H6.5v-2L11 13a4 4 0 0 1-2.5-4.5Z', 'M14 8.5h.01'],
  },
};

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function isIconName(v: string): v is IconName {
  return v in PATHS;
}

export function Icon({
  name,
  size = 22,
  color,
  /** Raise on a filled tile, where a 20% body disappears into the fill. */
  fillOpacity = 0.2,
  testID,
}: {
  name: IconName;
  size?: number;
  color: string;
  fillOpacity?: number;
  testID?: string;
}): React.JSX.Element {
  const g = PATHS[name];
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 24 24">
      <Path d={g.body} fill={color} fillOpacity={fillOpacity} />
      {g.lines.map((d, i) => (
        <Path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
