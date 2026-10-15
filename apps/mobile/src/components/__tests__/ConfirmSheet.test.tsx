import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ask, ConfirmHost } from '../ConfirmSheet';
import { ThemeProvider } from '@/theme/theme-context';
import { tokens } from '@/theme/tokens';

const mountHost = () => render(<ThemeProvider><ConfirmHost /></ThemeProvider>);

describe('ConfirmSheet — every "are you sure?" in the app (9 Oct 2026)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('draws the question as a sheet, not the stock Android dialog', () => {
    const spy = jest.spyOn(Alert, 'alert');
    mountHost();
    act(() => ask('Sign out?', 'This removes every profile on this phone.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', style: 'destructive' }]));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-title').props.children).toBe('Sign out?');
    expect(screen.getByText('This removes every profile on this phone.')).toBeTruthy();
    expect(screen.getByTestId('confirm-action-0')).toBeTruthy();
    expect(screen.getByTestId('confirm-cancel')).toBeTruthy();
  });

  it('runs the action and closes', () => {
    const go = jest.fn();
    mountHost();
    act(() => ask('Delete this assignment?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes, delete', style: 'destructive', onPress: go }]));
    fireEvent.press(screen.getByText('Yes, delete'));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('confirm-title')).toBeNull();
  });

  it('a tap on the dimmed page is the cancel button (and the dismiss callback)', () => {
    const cancel = jest.fn();
    const dismiss = jest.fn();
    const go = jest.fn();
    mountHost();
    act(() => ask('Replace the register?', 'x', [{ text: 'Cancel', style: 'cancel', onPress: cancel }, { text: 'Replace', style: 'destructive', onPress: go }], { onDismiss: dismiss }));
    fireEvent.press(screen.getByTestId('confirm-backdrop'));
    expect(cancel).toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('paints a removing action red and a plain one in the accent', () => {
    mountHost();
    act(() => ask('Sign out?', undefined, [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', style: 'destructive' }]));
    const flat = (id: string) => {
      const st = screen.getByTestId(id).props.style;
      return Array.isArray(st) ? Object.assign({}, ...st) : st;
    };
    expect(flat('confirm-action-0').backgroundColor).toBe(tokens.color.red);
    fireEvent.press(screen.getByTestId('confirm-cancel'));
    act(() => ask('Publish this meet?', undefined, [{ text: 'Not yet', style: 'cancel' }, { text: 'Publish' }]));
    expect(flat('confirm-action-0').backgroundColor).toBe(tokens.color.indigo);
  });

  it('every button clears the 48 dp touch floor', () => {
    mountHost();
    act(() => ask('Sign out?', undefined, [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', style: 'destructive' }]));
    for (const id of ['confirm-action-0', 'confirm-cancel']) {
      const st = screen.getByTestId(id).props.style;
      const flat = Array.isArray(st) ? Object.assign({}, ...st) : st;
      expect(flat.minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  it('shows who is being signed out', () => {
    mountHost();
    act(() => ask('Sign out?', undefined, [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', style: 'destructive' }], { who: { initials: 'RS', name: 'Rekha Sinha', line: 'Teacher' }, testID: 'confirm-signout' }));
    expect(screen.getByTestId('confirm-signout-who')).toBeTruthy();
    expect(screen.getByText('Rekha Sinha')).toBeTruthy();
    expect(screen.getByText('Teacher')).toBeTruthy();
  });

  it('with no host mounted it falls back to Alert, so a confirm can never vanish', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const buttons = [{ text: 'OK' }];
    ask('Saved', 'Done.', buttons);
    expect(spy).toHaveBeenCalledWith('Saved', 'Done.', buttons);
  });
});

describe('no screen draws the stock dialog any more', () => {
  it('Alert.alert appears only inside ConfirmSheet (its no-host fallback)', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const root = path.join(__dirname, '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
        } else if (/\.tsx?$/.test(e.name) && !p.endsWith('ConfirmSheet.tsx') && fs.readFileSync(p, 'utf8').includes('Alert.alert(')) {
          hits.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
