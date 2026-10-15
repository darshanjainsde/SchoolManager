import { render, screen } from '@testing-library/react-native';
import { Empty } from '../ui';
import { EmptyArt, sceneFor, ART_HEIGHT, type ArtScene } from '../EmptyArt';
import { ThemeProvider } from '@/theme/theme-context';
import { ICON_NAMES } from '../icons';

function mount(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('sceneFor — which moving picture an empty state gets', () => {
  it('never puts a picture on an error', () => {
    expect(sceneFor('messages', 'error')).toBeUndefined();
  });
  it('lets the kind tell the story where it changes it', () => {
    expect(sceneFor('fees', 'locked')).toBe('locked');
    expect(sceneFor('timetable', 'done')).toBe('done');
    expect(sceneFor('assignments', 'choose')).toBe('choose');
    expect(sceneFor(undefined, 'search')).toBe('search');
  });
  it('otherwise picks by the tool', () => {
    expect(sceneFor('messages')).toBe('chat');
    expect(sceneFor('concern')).toBe('chat');
    expect(sceneFor('fees')).toBe('coin');
    expect(sceneFor('library')).toBe('shelf');
    expect(sceneFor('sports')).toBe('ball');
    expect(sceneFor('holidays')).toBe('calendar');
    expect(sceneFor('cake')).toBe('cake');
  });
  it('leaves a bare sentence bare ("Opening the diary…")', () => {
    expect(sceneFor(undefined, undefined)).toBeUndefined();
  });
  it('a first-use empty with an unmapped glyph still gets the paper plane', () => {
    expect(sceneFor('palette', 'first')).toBe('plane');
  });
});

describe('EmptyArt', () => {
  const scenes: ArtScene[] = ['chat', 'write', 'choose', 'search', 'shelf', 'coin', 'ball', 'calendar', 'plane', 'done', 'locked', 'cake', 'phone'];
  it.each(scenes)('draws %s without throwing, at a fixed small height, hidden from screen readers', (s) => {
    mount(<EmptyArt scene={s} />);
    const box = screen.getByTestId(`empty-art-${s}`, { includeHiddenElements: true });
    expect(box.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(box.props.style.height).toBe(ART_HEIGHT);
  });
  it('stays under a third of a small phone (640 dp tall)', () => {
    expect(ART_HEIGHT).toBeLessThanOrEqual(640 / 3);
  });
  it('every icon either maps to a scene or falls back cleanly', () => {
    for (const n of ICON_NAMES) expect(() => sceneFor(n)).not.toThrow();
  });
});

describe('Empty with the moving picture', () => {
  it('shows the picture above the words for a tool empty state', () => {
    mount(<Empty icon="messages" title="No questions yet">When a family writes, it lands here.</Empty>);
    expect(screen.getByTestId('empty-art-chat', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('No questions yet')).toBeTruthy();
  });
  it('art={false} keeps the plain glyph', () => {
    mount(<Empty icon="messages" art={false}>No messages yet.</Empty>);
    expect(screen.queryByTestId('empty-art-chat', { includeHiddenElements: true })).toBeNull();
  });
  it('a still scene (Illustration) wins over the moving one', () => {
    mount(<Empty icon="fees" scene="feesPaid">Nothing due.</Empty>);
    expect(screen.getByTestId('illustration-feesPaid')).toBeTruthy();
    expect(screen.queryByTestId('empty-art-coin', { includeHiddenElements: true })).toBeNull();
  });
  it('an error keeps its alert glyph and gets no picture', () => {
    mount(<Empty kind="error" title="Could not load">Try again.</Empty>);
    expect(screen.queryByTestId(/empty-art-/, { includeHiddenElements: true })).toBeNull();
  });
});
