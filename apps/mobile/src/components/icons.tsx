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
  | 'library';

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

  // Three books on a shelf — two standing, one leaning: the Library tab's
  // duotone twin of the bar's Ionicons 'library-outline'.
  library: {
    body: 'M4.5 5.5h3.4v13H4.5Z M9.4 5.5h3.4v13H9.4Z M14.2 6.7l3.2 1-3.7 12.3-3.2-1Z',
    lines: [
      'M4.5 5.5h3.4v13H4.5Z',
      'M9.4 5.5h3.4v13H9.4Z',
      'M14.2 6.7l3.2 1-3.7 12.3-3.2-1Z',
      'M4.5 15.4h3.4M9.4 15.4h3.4',
    ],
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
