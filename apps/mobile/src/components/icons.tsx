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
  | 'fees'
  | 'sports'
  | 'library'
  | 'cake'
  | 'report'
  | 'bell'
  | 'chevron'
  | 'offline'
  | 'pin'
  | 'send'
  | 'mail'
  | 'phone'
  | 'palette'
  | 'key'
  | 'concern'
  | 'search'
  | 'lock'
  | 'alert'
  | 'check'
  | 'signout'
  | 'trash'
  | 'syllabus'
  | 'test'
  | 'pay'
  | 'ask'
  | 'books'
  | 'hall'
  | 'fines'
  | 'members'
  | 'meets'
  | 'records'
  | 'houses'
  | 'rules'
  | 'decide'
  | 'cover'
  | 'staff'
  | 'present';

/**
 * DUOTONE OBJECTS (16 Oct 2026). Each glyph is drawn as a thing, not an
 * outline: `body` is the object's soft fill, `lines` its ink outline and the
 * one detail that names it (the ribbon in Diary, the clock on Requests, the
 * sun in Holidays, the rupee coin on My pay), `solid` the detail drawn in full
 * ink, `knock` a cut-out in the tile's own colour so a badge sits ON the
 * object, `dim` a faint guide line. 24-px grid, 1.8 stroke, so the set reads
 * as one hand. Fill and ink come from the tool's family (theme/families.ts).
 */
interface Glyph {
  body: string;
  lines: string[];
  solid?: string[];
  knock?: string[];
  dim?: string[];
}

const PATHS: Record<IconName, Glyph> = {
  take: {
    body: 'M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5z',
    lines: ['M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5z', 'M8.5 11l1.6 1.6 2.6-2.8M8.5 16l1.6 1.6 2.6-2.8M14.5 11.5h2M14.5 16.5h2'],
    solid: ['M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1z'],
  },
  assignments: {
    body: 'M6 7.5A1.5 1.5 0 0 1 7.5 6h8A1.5 1.5 0 0 1 17 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 18.5z',
    lines: ['M6 7.5A1.5 1.5 0 0 1 7.5 6h8A1.5 1.5 0 0 1 17 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 18.5zM8.5 4h8A1.5 1.5 0 0 1 18 5.5v9.5', 'M9 10.5h5M9 13.5h3', 'M18.6 11.2l2.1 2.1-5.1 5.1-2.6.5.5-2.6z'],
    solid: ['M18.6 11.2l2.1 2.1-5.1 5.1-2.6.5.5-2.6z'],
  },
  messages: {
    body: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.2A.7.7 0 0 1 4.7 19.6V17A2.5 2.5 0 0 1 4 14.5z',
    lines: ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.2A.7.7 0 0 1 4.7 19.6V17A2.5 2.5 0 0 1 4 14.5z'],
    solid: ['M7.4 10.5a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0', 'M10.9 10.5a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0', 'M14.4 10.5a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0'],
  },
  diary: {
    body: 'M6 4.5A1.5 1.5 0 0 1 7.5 3H18a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 18 21H7.5A1.5 1.5 0 0 1 6 19.5z',
    lines: ['M6 4.5A1.5 1.5 0 0 1 7.5 3H18a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 18 21H7.5A1.5 1.5 0 0 1 6 19.5z', 'M4.5 7.5h3M4.5 12h3M4.5 16.5h3'],
    solid: ['M13.5 3h3v7l-1.5-1.2L13.5 10z'],
  },
  notices: {
    body: 'M4 10.5A1.5 1.5 0 0 1 5.5 9H9l7-4.5v15L9 15H5.5A1.5 1.5 0 0 1 4 13.5z',
    lines: ['M4 10.5A1.5 1.5 0 0 1 5.5 9H9l7-4.5v15L9 15H5.5A1.5 1.5 0 0 1 4 13.5zM7.5 15l1 4.5h2.5L10 15', 'M18.5 9.5a3.5 3.5 0 0 1 0 5M20.5 7.3a6.5 6.5 0 0 1 0 9.4'],
  },
  timetable: {
    body: 'M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5z',
    lines: ['M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5zM3.5 9.5h17M9 9.5V20M15 9.5V20M3.5 14.5h17'],
    solid: ['M9 9.5h6v5H9z'],
  },
  results: {
    body: 'M7 4h10v4.5a5 5 0 0 1-10 0z',
    lines: ['M7 4h10v4.5a5 5 0 0 1-10 0zM7 5.5H4.5a2.5 2.5 0 0 0 2.5 4M17 5.5h2.5a2.5 2.5 0 0 1-2.5 4M12 13.5V17M8.5 20h7M9.5 17h5v3h-5z'],
    solid: ['M12 6.2l.8 1.6 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.3z'],
  },
  requests: {
    body: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z',
    lines: ['M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5zM3.5 7.5 12 13l8.5-5.5', 'M15.3 17.5a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0', 'M18.5 15.8v1.9l1.2.8'],
    knock: ['M14.9 17.5a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0'],
  },
  holidays: {
    body: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h14A1.5 1.5 0 0 1 20.5 7v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z',
    lines: ['M3.5 7A1.5 1.5 0 0 1 5 5.5h14A1.5 1.5 0 0 1 20.5 7v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19zM3.5 10h17M8 3.5v4M16 3.5v4', 'M12 11.2v-.4M12 19.2v-.4M8.2 15h-.4M16.2 15h-.4M9.3 12.3l-.3-.3M15 17.7l-.3-.3M14.7 12.3l.3-.3M9 17.7l.3-.3'],
    solid: ['M9.7 15a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0'],
  },
  notes: {
    body: 'M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v9l-5.5 5.5h-7A1.5 1.5 0 0 1 5 18.5z',
    lines: ['M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v9l-5.5 5.5h-7A1.5 1.5 0 0 1 5 18.5z', 'M13.5 20v-4a1.5 1.5 0 0 1 1.5-1.5h4M8.5 9h7M8.5 12.5h4.5'],
  },
  home: {
    body: 'M4.4 10.6 12 4.4l7.6 6.2v8.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1Z',
    lines: ['M4.4 10.6 12 4.4l7.6 6.2v8.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1Z'],
  },
  person: {
    body: 'M4.5 20a7.5 7.5 0 0 1 15 0z M8 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    lines: ['M4.5 20a7.5 7.5 0 0 1 15 0z', 'M8 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0'],
  },
  fees: {
    body: 'M3.5 8A1.5 1.5 0 0 1 5 6.5h14A1.5 1.5 0 0 1 20.5 8v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z',
    lines: ['M3.5 8A1.5 1.5 0 0 1 5 6.5h14A1.5 1.5 0 0 1 20.5 8v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17zM6 6.5V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 5v1.5'],
    solid: ['M14.5 11h6v4h-6a2 2 0 0 1 0-4z'],
    knock: ['M15.6 13a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0'],
  },
  sports: {
    body: 'M4 13.5a5 5 0 1 0 10 0 5 5 0 0 0-10 0z',
    lines: ['M4 13.5a5 5 0 1 0 10 0 5 5 0 0 0-10 0zM13.5 10.5 20 7.5v3l-5.5 2.5M11.5 9V6.5h3'],
    solid: ['M7.8 13.5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0'],
  },
  library: {
    body: 'M3.5 5.5h3.6v14H3.5zM9 3.5h3.6v16H9z',
    lines: ['M3.5 5.5h3.6v14H3.5zM9 3.5h3.6v16H9zM5.3 8.5v8M10.8 6.5v10', 'M14.2 6.2l3.4-.9 3.5 13.4-3.4.9z'],
    solid: ['M14.2 6.2l3.4-.9 3.5 13.4-3.4.9z'],
  },
  cake: {
    body: 'M4.5 12.5A1.5 1.5 0 0 1 6 11h12a1.5 1.5 0 0 1 1.5 1.5V20h-15z',
    lines: ['M4.5 12.5A1.5 1.5 0 0 1 6 11h12a1.5 1.5 0 0 1 1.5 1.5V20h-15zM4.5 15.5c1.5 1.5 3 0 4.5 0s3 1.5 4.5 0 3 0 4.5 0M12 11V8'],
    solid: ['M12 3.5c1 1.3 1.6 2.2 1.6 3a1.6 1.6 0 0 1-3.2 0c0-.8.6-1.7 1.6-3z'],
  },
  report: {
    body: 'M6 5.5A1.5 1.5 0 0 1 7.5 4h7l3.5 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18.5z',
    lines: ['M6 5.5A1.5 1.5 0 0 1 7.5 4h7l3.5 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18.5zM14.5 4v3.5H18', 'M9 11h6M9 14h4'],
    solid: ['M15.5 14.5l.6 1.2 1.3.2-.9.9.2 1.3-1.2-.6-1.2.6.2-1.3-.9-.9 1.3-.2z'],
  },
  bell: {
    body: 'M7 16V11a5 5 0 0 1 10 0v5l1.5 1.8H5.5Z',
    lines: ['M7 16V11a5 5 0 0 1 10 0v5l1.5 1.8H5.5Z', 'M10 19.5a2 2 0 0 0 4 0M12 4.2v1.8'],
  },
  chevron: {
    body: '',
    lines: ['M14.5 6 8.5 12l6 6'],
  },
  offline: {
    body: 'M7 17.5a3.5 3.5 0 0 1-.4-7 5 5 0 0 1 9.6-1.2A3.4 3.4 0 0 1 17.5 17.5Z',
    lines: ['M7 17.5a3.5 3.5 0 0 1-.4-7 5 5 0 0 1 9.6-1.2A3.4 3.4 0 0 1 17.5 17.5Z', 'M4 4l16 16'],
  },
  pin: {
    body: 'M9 4.5h6l-1 5.5 2.5 2.5v1.5H7.5v-1.5L10 10Z',
    lines: ['M9 4.5h6l-1 5.5 2.5 2.5v1.5H7.5v-1.5L10 10Z', 'M12 14v5.5'],
  },
  send: {
    body: 'M4.5 11.5 19.5 5l-4 14-4.5-5Z',
    lines: ['M4.5 11.5 19.5 5l-4 14-4.5-5Z', 'M11 14l8.5-9'],
  },
  mail: {
    body: 'M4.5 7A1.5 1.5 0 0 1 6 5.5h12A1.5 1.5 0 0 1 19.5 7v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 17Z',
    lines: ['M4.5 7A1.5 1.5 0 0 1 6 5.5h12A1.5 1.5 0 0 1 19.5 7v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 17Z', 'm5 7.5 7 5.5 7-5.5'],
  },
  phone: {
    body: 'M4 12a8 8 0 1 1 3.3 6.5L4 20l1.5-3.3A8 8 0 0 1 4 12z',
    lines: ['M4 12a8 8 0 1 1 3.3 6.5L4 20l1.5-3.3A8 8 0 0 1 4 12z', 'M9.2 9.3c.3-.8 1.1-.8 1.4-.2l.6 1.2c.1.3 0 .6-.2.8l-.5.5c.6 1.1 1.4 1.9 2.5 2.5l.5-.5c.2-.2.5-.3.8-.2l1.2.6c.6.3.6 1.1-.2 1.4-1.9.9-6.9-4.1-6.1-6.1z'],
  },
  palette: {
    body: 'M12 4.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.8 1.2-1.7-.5-1 .2-2 1.3-2H16a3.5 3.5 0 0 0 3.5-3.5A7.5 7.5 0 0 0 12 4.5Z',
    lines: ['M12 4.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.8 1.2-1.7-.5-1 .2-2 1.3-2H16a3.5 3.5 0 0 0 3.5-3.5A7.5 7.5 0 0 0 12 4.5Z', 'M8.5 12.5h.01M10.5 8.5h.01M14.5 8.5h.01'],
  },
  key: {
    body: 'M4 9.5A5.5 5.5 0 0 1 14.6 7.5H20l1.5 1.5-2 2-1.5-1.5-1.5 1.5-1.5-1.5h-.4A5.5 5.5 0 1 1 4 9.5z',
    lines: ['M4 9.5A5.5 5.5 0 0 1 14.6 7.5H20l1.5 1.5-2 2-1.5-1.5-1.5 1.5-1.5-1.5h-.4A5.5 5.5 0 1 1 4 9.5z'],
    solid: ['M6.9 9.5a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0'],
  },
  concern: {
    body: 'M3.5 9.5A1.5 1.5 0 0 1 5 8h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19z',
    lines: ['M3.5 9.5A1.5 1.5 0 0 1 5 8h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19z', 'M9 8V5.2A1.2 1.2 0 0 1 10.2 4h4.6A1.2 1.2 0 0 1 16 5.2V8', 'M12.5 6.2v.01'],
    solid: ['M7.5 11.5h9v1.6h-9z'],
  },
  search: {
    body: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z',
    lines: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z', 'M16 16l4 4'],
  },
  lock: {
    body: 'M5.5 11h13A1.5 1.5 0 0 1 20 12.5v6a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-6A1.5 1.5 0 0 1 5.5 11Z',
    lines: ['M5.5 11h13A1.5 1.5 0 0 1 20 12.5v6a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-6A1.5 1.5 0 0 1 5.5 11Z', 'M6.5 11V8a5.5 5.5 0 0 1 11 0v3M12 14.5v2'],
  },
  alert: {
    body: 'M12 3.5l9 15.5H3Z',
    lines: ['M12 3.5l9 15.5H3Z', 'M12 10v4M12 17v.5'],
  },
  check: {
    body: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
    lines: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z', 'M8.5 12.2l2.4 2.4 4.8-5'],
  },
  signout: {
    body: 'M5.5 4.5h7a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-7Z',
    lines: ['M14 4.5H7A1.5 1.5 0 0 0 5.5 6v12A1.5 1.5 0 0 0 7 19.5h7', 'M10.5 12h9M16.5 9l3 3-3 3'],
  },
  trash: {
    body: 'M6.5 7.5h11l-1 11.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5Z',
    lines: ['M6.5 7.5h11l-1 11.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5Z', 'M4.5 7.5h15M9.5 7.5V5.5h5v2M10.5 11v6M13.5 11v6'],
  },
  syllabus: {
    body: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h7.5v16H5.5A1.5 1.5 0 0 1 4 18.5z',
    lines: ['M4 5.5A1.5 1.5 0 0 1 5.5 4h7.5v16H5.5A1.5 1.5 0 0 1 4 18.5zM7 8.5h3.5M7 12h3.5M7 15.5h2', 'M13 20h5.5a1.5 1.5 0 0 0 1.5-1.5V12', 'M17.5 3.9a3.6 3.6 0 0 1 3.4 4.7'],
    solid: ['M16 7.6l1.1 1.1 2-2.2-.6-.6-1.4 1.5-.5-.5z'],
    dim: ['M13.9 7.5a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0'],
  },
  test: {
    body: 'M3.5 6A1.5 1.5 0 0 1 5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z',
    lines: ['M3.5 6A1.5 1.5 0 0 1 5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z'],
    solid: ['M7 12h2.4v4.5H7zM10.8 8.5h2.4v8h-2.4zM14.6 10.5H17v6h-2.4z'],
  },
  pay: {
    body: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v13l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2z',
    lines: ['M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v13l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2zM7 8h6M7 11.5h4', 'M13.5 15.5a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M15.8 13.6h3.4M15.8 15.1h3.4M16.4 13.6a1.5 1.5 0 0 1 0 3h-.6l2.2 2.2'],
    knock: ['M13.1 15.5a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0'],
  },
  ask: {
    body: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.2A.7.7 0 0 1 4.7 19.6V17A2.5 2.5 0 0 1 4 14.5z',
    lines: ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.2A.7.7 0 0 1 4.7 19.6V17A2.5 2.5 0 0 1 4 14.5z', 'M10 9.2a2 2 0 0 1 4 0c0 1.3-2 1.5-2 3'],
    solid: ['M11 14.6a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
  },
  books: {
    body: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5z M13 4h5.5A1.5 1.5 0 0 1 20 5.5v12a1.5 1.5 0 0 1-1.5 1.5H13z',
    lines: ['M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v12a1.5 1.5 0 0 1-1.5 1.5H13zM11 19a1.5 1.5 0 0 0 2 0M7 8h2M15 8h2'],
  },
  hall: {
    body: 'M5 20V9a7 7 0 0 1 14 0v11z',
    lines: ['M5 20V9a7 7 0 0 1 14 0v11zM3 20h18M9 20v-6a3 3 0 0 1 6 0v6'],
    solid: ['M11 8.5h2v3h-2z'],
  },
  fines: {
    body: 'M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0z',
    lines: ['M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0z'],
    solid: ['M11 7h2v6h-2z', 'M10.8 16.2a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0'],
  },
  members: {
    body: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z',
    lines: ['M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z', 'M6.8 10.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0', 'M5.5 16.5a3.5 3.5 0 0 1 7 0M14.5 10h3M14.5 13h3'],
  },
  meets: {
    body: 'M6 4.5h12l-2.5 4 2.5 4H6z',
    lines: ['M6 4.5h12l-2.5 4 2.5 4H6zM6 3.5v17'],
    solid: ['M9 7.5h3v2H9z'],
  },
  records: {
    body: 'M5 13.5a7 7 0 1 0 14 0 7 7 0 0 0-14 0z',
    lines: ['M5 13.5a7 7 0 1 0 14 0 7 7 0 0 0-14 0zM12 6.5V4M10 4h4M18 8l1.2-1.2', 'M12 13.5V10'],
    solid: ['M10.7 13.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0'],
  },
  houses: {
    body: 'M12 3.5 19 6v6c0 4.2-3 7.3-7 8.5-4-1.2-7-4.3-7-8.5V6z',
    lines: ['M12 3.5 19 6v6c0 4.2-3 7.3-7 8.5-4-1.2-7-4.3-7-8.5V6z'],
    solid: ['M12 7.5v12.2c3.3-1.1 5.6-3.7 5.6-7.2V8.3z'],
  },
  rules: {
    body: 'M6 5.5A1.5 1.5 0 0 1 7.5 4h9A1.5 1.5 0 0 1 18 5.5v14.5l-3-2-3 2-3-2-3 2z',
    lines: ['M6 5.5A1.5 1.5 0 0 1 7.5 4h9A1.5 1.5 0 0 1 18 5.5v14.5l-3-2-3 2-3-2-3 2zM9 8.5h6M9 12h6M9 15.5h3'],
  },
  decide: {
    body: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z',
    lines: ['M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM7 9.5l1.6 1.6 2.6-2.8M7 15l1.6 1.6 2.6-2.8', 'M14 9.5l3 3M17 9.5l-3 3', 'M14 14.5h3'],
  },
  cover: {
    body: 'M5 7.5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M13 7.5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
    lines: ['M5 7.5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M13 7.5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M3.5 19a4.5 4.5 0 0 1 9 0M11.5 19a4.5 4.5 0 0 1 9 0'],
    solid: ['M10.5 12.5h3l-1.5 2z'],
  },
  staff: {
    body: 'M3.5 19a4.5 4.5 0 0 1 9 0z M12.5 19a4.5 4.5 0 0 1 8 0z M4.8 9a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0 M13.9 9.5a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0',
    lines: ['M3.5 19a4.5 4.5 0 0 1 9 0zM12.5 19a4.5 4.5 0 0 1 8 0z', 'M4.8 9a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0', 'M13.9 9.5a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0'],
  },
  present: {
    body: 'M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0z',
    lines: ['M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0z', 'M8.5 12.2l2.4 2.4 4.8-5.2'],
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
  /** The surface under the glyph, for its cut-outs (a badge on an envelope). Omit to skip them. */
  knockColor,
  testID,
}: {
  name: IconName;
  size?: number;
  color: string;
  fillOpacity?: number;
  knockColor?: string;
  testID?: string;
}): React.JSX.Element {
  const g = PATHS[name];
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 24 24">
      <Path d={g.body} fill={color} fillOpacity={fillOpacity} />
      {knockColor && g.knock?.map((d, i) => <Path key={`k${i}`} d={d} fill={knockColor} />)}
      {g.solid?.map((d, i) => <Path key={`s${i}`} d={d} fill={color} />)}
      {g.dim?.map((d, i) => (
        <Path key={`d${i}`} d={d} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      ))}
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
