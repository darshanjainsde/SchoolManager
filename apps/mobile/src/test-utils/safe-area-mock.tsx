/**
 * Jest stand-in for react-native-safe-area-context, wired via
 * moduleNameMapper in package.json. NOT the library's own jest/mock — that
 * file exposes ONLY a default export (v5), so a named import of
 * `useSafeAreaInsets` resolves undefined and crashes every Screen render
 * (see mistake ledger: rnsac-jest-mock-default-only). This local mock exports
 * exactly the named surface our source imports.
 */
import type { PropsWithChildren } from 'react';

const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };

export function useSafeAreaInsets() {
  return ZERO;
}

export function useSafeAreaFrame() {
  return { x: 0, y: 0, width: 390, height: 844 };
}

export function SafeAreaProvider({ children }: PropsWithChildren) {
  return children as React.JSX.Element;
}

export function SafeAreaView({ children }: PropsWithChildren) {
  return children as React.JSX.Element;
}

export const initialWindowMetrics = { insets: ZERO, frame: { x: 0, y: 0, width: 390, height: 844 } };
