# Sckools Mobile — Phase 1 "Trust Loop" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/mobile` (Expo) with the P1 trust loop — login → role-routed portals; teacher takes attendance (school-wide lock + retake); parents/students get push + see attendance, notices, holidays — and produce the signed `.aab` for the Play closed test.

**Architecture:** New Expo workspace `apps/mobile` consumes the existing NestJS API (`apps/api`) via the `X-Skoolos-Host` tenant header + JWT. Backend already has `POST /auth/login`, `manage/attendance` (GET/PUT), `manage/announcements`, and the `/me/*` student portal — we add only the gaps: attendance day-status, teacher class list, push tokens + a push NotificationChannel, teacher multi-class announcements, and a Holiday model. Push rides the existing channel-based `NotificationService` (add a channel; touch no callers).

**Tech Stack:** Expo SDK 53 (expo-router, expo-secure-store, expo-notifications), react-native-svg, jest-expo + @testing-library/react-native, Maestro (E2E), NestJS + Prisma + jest (existing), expo-server-sdk (API side), EAS Build/Submit/Update.

## Global Constraints

- Branch: `git checkout main && git pull && git checkout -b feat/mobile-p1` (do NOT build on `feat/blog-platform`).
- **Never `git add -A` / `git add .`** — this working tree has iCloud `" 2"` conflict copies. Stage explicit paths only.
- Package manager: `pnpm` (workspace already includes `apps/*`). Node per repo root `.nvmrc`/engines if present.
- Brand: user-facing name is **Sckools**; Android package/applicationId is **`com.sckools.app`** (permanent — never change).
- Brand colors: indigo `#4F46E5`, amber `#F59E0B` (dark variants `#818CF8` / `#FBBF24`); logo = Tassel-S (`apps/web/components/brand/sckools-logo.tsx` is the reference SVG).
- UI source of truth: `design/sckools-app/mobile-mockup-v2.html` — match its spacing system (11px vertical gap between containers), card style, and copy.
- API base URL and tenant: every request carries `X-Skoolos-Host: <school>.sckools.com` (see `apps/api/src/modules/tenancy/internal/tenant.middleware.ts`). Local dev API: `http://localhost:4000` (confirm port in `apps/api` env).
- Prisma CLI on this machine needs `DIRECT_URL` set (session pooler breaks migrate) — see memory note "Local dev quirks".
- Existing roles enum: `OWNER | SCHOOL_ADMIN | TEACHER | STUDENT | STAFF`. P1 role→portal map: `STUDENT → family`, `TEACHER | SCHOOL_ADMIN | STAFF → staff`. (Parent accounts are a Phase 2 memberships migration; in P1 parents use the student's credentials.)
- API test runner is jest: `pnpm --filter api test -- <pattern>`. Mirror the mocking style of the neighbouring `*.spec.ts` in the same folder.
- Commit after every task (explicit paths). Conventional commits (`feat(mobile): …`, `feat(api): …`, `test: …`, `docs: …`).

---

### Task 1: Scaffold `apps/mobile` (Expo + expo-router in the monorepo)

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.config.ts`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/babel.config.js`
- Create: `apps/mobile/metro.config.js`
- Create: `apps/mobile/src/app/_layout.tsx`
- Create: `apps/mobile/src/app/index.tsx`
- Create: `apps/mobile/.gitignore`

**Interfaces:**
- Produces: workspace package named `@skoolos/mobile`; entry `expo-router/entry`; route tree under `apps/mobile/src/app`.

- [ ] **Step 1: Create the package manifest**

`apps/mobile/package.json`:

```json
{
  "name": "@skoolos/mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "typecheck": "tsc --noEmit",
    "test": "jest"
  },
  "dependencies": {
    "expo": "~53.0.0",
    "expo-constants": "~17.1.3",
    "expo-linking": "~7.1.3",
    "expo-router": "~5.0.3",
    "expo-secure-store": "~14.2.3",
    "expo-status-bar": "~2.2.3",
    "react": "19.0.0",
    "react-native": "0.79.2",
    "react-native-safe-area-context": "5.4.0",
    "react-native-screens": "~4.10.0",
    "react-native-svg": "15.11.2"
  },
  "devDependencies": {
    "@types/react": "~19.0.10",
    "typescript": "~5.8.3"
  }
}
```

- [ ] **Step 2: App config with the permanent identity**

`apps/mobile/app.config.ts`:

```ts
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Sckools',
  slug: 'sckools',
  scheme: 'sckools',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'com.sckools.app',
    adaptiveIcon: { backgroundColor: '#4F46E5' },
  },
  ios: { bundleIdentifier: 'com.sckools.app' },
  plugins: ['expo-router', 'expo-secure-store'],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default config;
```

- [ ] **Step 3: TS/Babel/Metro config (monorepo-aware)**

`apps/mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "app.config.ts"]
}
```

`apps/mobile/babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
```

`apps/mobile/metro.config.js` (pnpm monorepo resolution):

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
module.exports = config;
```

`apps/mobile/.gitignore`:

```
.expo/
android/
ios/
dist/
```

- [ ] **Step 4: Root layout + placeholder screen**

`apps/mobile/src/app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`apps/mobile/src/app/index.tsx`:

```tsx
import { Text, View } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Sckools</Text>
    </View>
  );
}
```

- [ ] **Step 5: Install & verify**

Run from repo root:

```bash
pnpm install
pnpm --filter @skoolos/mobile exec npx expo install --fix
pnpm --filter @skoolos/mobile typecheck
```

Expected: install succeeds; `expo install --fix` pins compatible native versions; typecheck passes. (If iCloud has evicted binaries, see memory "Local dev quirks" — re-download via Finder.)

- [ ] **Step 6: Boot smoke test**

```bash
pnpm --filter @skoolos/mobile start
```

Expected: Metro starts, QR shown. Press `w` or open in Expo Go — screen shows "Sckools". Ctrl-C after.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.config.ts apps/mobile/tsconfig.json \
  apps/mobile/babel.config.js apps/mobile/metro.config.js apps/mobile/src apps/mobile/.gitignore pnpm-lock.yaml
git commit -m "feat(mobile): scaffold Expo app in monorepo (com.sckools.app)"
```

---

### Task 2: Test infra, design tokens & the Tassel-S logo component

**Files:**
- Modify: `apps/mobile/package.json` (add jest-expo deps + jest config)
- Create: `apps/mobile/src/theme/tokens.ts`
- Create: `apps/mobile/src/components/SckoolsLogo.tsx`
- Test: `apps/mobile/src/components/__tests__/SckoolsLogo.test.tsx`

**Interfaces:**
- Produces: `tokens` object (`tokens.color.indigo`, `.amber`, `.ink`, `.sub`, `.line`, `.appBg`, `.surface`, `.green`, `.red`, spacing `tokens.gap = 11`); `<SckoolsLogo size={number} theme?: 'light'|'dark' variant?: 'full'|'symbol' />`.

- [ ] **Step 1: Add test tooling**

```bash
pnpm --filter @skoolos/mobile add -D jest-expo@~53.0.0 jest@~29.7.0 @testing-library/react-native@~13.2.0 react-test-renderer@19.0.0
```

Append to `apps/mobile/package.json`:

```json
"jest": {
  "preset": "jest-expo",
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|expo-router|react-native-svg)"
  ]
}
```

- [ ] **Step 2: Write the failing logo test**

`apps/mobile/src/components/__tests__/SckoolsLogo.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import { SckoolsLogo } from '../SckoolsLogo';

describe('SckoolsLogo', () => {
  it('renders the wordmark by default', () => {
    const { getByText } = render(<SckoolsLogo size={32} />);
    expect(getByText('Sckools')).toBeTruthy();
  });

  it('omits the wordmark for the symbol variant', () => {
    const { queryByText } = render(<SckoolsLogo size={32} variant="symbol" />);
    expect(queryByText('Sckools')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @skoolos/mobile test -- SckoolsLogo`
Expected: FAIL — cannot find module `../SckoolsLogo`.

- [ ] **Step 4: Tokens + logo implementation**

`apps/mobile/src/theme/tokens.ts` (values from `design/sckools-app/mobile-mockup-v2.html`):

```ts
export const tokens = {
  color: {
    indigo: '#4F46E5', indigoDark: '#818CF8', indigo50: '#EEF0FF',
    amber: '#F59E0B', amberDark: '#FBBF24', amber50: '#FFF6E6',
    ink: '#0F172A', sub: '#64748B', line: '#E9E9F2',
    green: '#16B364', green50: '#E7F7EF', red: '#EF4444', red50: '#FDECEC',
    appBg: '#F4F5FB', surface: '#FFFFFF',
  },
  gap: 11,          // vertical rhythm between containers (mockup system)
  radius: { card: 16, chip: 999, sheet: 22 },
} as const;
```

`apps/mobile/src/components/SckoolsLogo.tsx` (direct port of `apps/web/components/brand/sckools-logo.tsx` paths):

```tsx
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { tokens } from '@/theme/tokens';

type Props = {
  size?: number;
  variant?: 'full' | 'symbol';
  theme?: 'light' | 'dark';
};

export function SckoolsLogo({ size = 32, variant = 'full', theme = 'light' }: Props) {
  const stroke = theme === 'dark' ? tokens.color.indigoDark : tokens.color.indigo;
  const tassel = theme === 'dark' ? tokens.color.amberDark : tokens.color.amber;
  const text = theme === 'dark' ? '#FFFFFF' : tokens.color.ink;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Svg width={size} height={size} viewBox="0 0 52 52">
        <Path
          d="M34 14 C34 8.5 25 7.5 19.3 10 C12 13 13.7 19 23.5 21.4 C33.5 24 35.2 29.7 29.3 33.4 C23.6 37 14.6 35.6 13.6 29.4"
          fill="none" stroke={stroke} strokeWidth={5} strokeLinecap="round"
        />
        <Line x1={41} y1={9} x2={41} y2={19} stroke={tassel} strokeWidth={2.4} strokeLinecap="round" />
        <Circle cx={41} cy={22} r={3} fill={tassel} />
      </Svg>
      {variant === 'full' && (
        <Text style={{ fontWeight: '800', letterSpacing: -0.5, fontSize: size * 0.62, color: text }}>
          Sckools
        </Text>
      )}
    </View>
  );
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @skoolos/mobile test -- SckoolsLogo`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/theme/tokens.ts \
  apps/mobile/src/components/SckoolsLogo.tsx apps/mobile/src/components/__tests__/SckoolsLogo.test.tsx pnpm-lock.yaml
git commit -m "feat(mobile): jest-expo test infra, design tokens, Tassel-S logo"
```

---

### Task 3: Session store & API client (tenant header + JWT + refresh)

**Files:**
- Create: `apps/mobile/src/lib/session.ts`
- Create: `apps/mobile/src/lib/api.ts`
- Test: `apps/mobile/src/lib/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `POST /auth/login` (`{ identifier, password }` → tokens+user), `POST /auth/refresh`, `GET /auth/me` — confirm exact response field names in `apps/api/src/modules/auth/internal/auth.service.ts` before coding and adjust the `Session` type to match verbatim.
- Produces:
  - `session.get(): Promise<Session | null>` / `session.set(s)` / `session.clear()` / `session.setSchoolHost(host)` where `Session = { accessToken: string; refreshToken: string; role: Role; schoolHost: string; displayName: string }` and `Role = 'STUDENT'|'TEACHER'|'SCHOOL_ADMIN'|'STAFF'|'OWNER'`.
  - `api.request<T>(path, opts?): Promise<T>` — injects `X-Skoolos-Host` + `Authorization`, one transparent refresh-and-retry on 401, throws `ApiError { status, message }`.
  - `api.login(host, identifier, password): Promise<Session>`.

- [ ] **Step 1: Read the auth contract**

Read `apps/api/src/modules/auth/internal/auth.service.ts` (login/refresh return shapes) and `auth.controller.ts`. Note the exact JSON field names for access token, refresh token, and user role. Use those names below (the plan assumes `{ accessToken, refreshToken, user: { role, ... } }` — adjust if the file differs).

- [ ] **Step 2: Write the failing API-client tests**

`apps/mobile/src/lib/__tests__/api.test.ts`:

```ts
import { api, ApiError } from '../api';
import { session } from '../session';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const seed = async () =>
  session.set({
    accessToken: 'at1', refreshToken: 'rt1', role: 'TEACHER',
    schoolHost: 'raffles.sckools.com', displayName: 'Ms. Rao',
  });

beforeEach(() => { mockFetch.mockReset(); });

it('attaches tenant host and bearer token', async () => {
  await seed();
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
  await api.request('/me/profile');
  const [, init] = mockFetch.mock.calls[0];
  expect(init.headers['X-Skoolos-Host']).toBe('raffles.sckools.com');
  expect(init.headers['Authorization']).toBe('Bearer at1');
});

it('refreshes once on 401 then retries', async () => {
  await seed();
  mockFetch
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accessToken: 'at2', refreshToken: 'rt2' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
  const out = await api.request<{ ok: number }>('/me/profile');
  expect(out.ok).toBe(1);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect((await session.get())?.accessToken).toBe('at2');
});

it('throws ApiError and clears session when refresh also fails', async () => {
  await seed();
  mockFetch
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
  await expect(api.request('/me/profile')).rejects.toBeInstanceOf(ApiError);
  expect(await session.get()).toBeNull();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @skoolos/mobile test -- api.test`
Expected: FAIL — modules `../api` / `../session` not found.

- [ ] **Step 4: Implement session + api**

`apps/mobile/src/lib/session.ts`:

```ts
import * as SecureStore from 'expo-secure-store';

export type Role = 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'STAFF' | 'OWNER';

export interface Session {
  accessToken: string;
  refreshToken: string;
  role: Role;
  schoolHost: string;   // e.g. "raffles.sckools.com"
  displayName: string;
}

const KEY = 'sckools.session';
const HOST_KEY = 'sckools.schoolHost';

export const session = {
  async get(): Promise<Session | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  },
  async set(s: Session): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  },
  async setSchoolHost(host: string): Promise<void> {
    await SecureStore.setItemAsync(HOST_KEY, host);
  },
  async getSchoolHost(): Promise<string | null> {
    return SecureStore.getItemAsync(HOST_KEY);
  },
};
```

`apps/mobile/src/lib/api.ts`:

```ts
import Constants from 'expo-constants';
import { session, type Session } from './session';

const BASE = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Opts { method?: string; body?: unknown; auth?: boolean }

async function rawFetch(path: string, s: Session | null, opts: Opts) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s) {
    headers['X-Skoolos-Host'] = s.schoolHost;
    if (opts.auth !== false) headers['Authorization'] = `Bearer ${s.accessToken}`;
  }
  return fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function tryRefresh(s: Session): Promise<Session | null> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Skoolos-Host': s.schoolHost },
    body: JSON.stringify({ refreshToken: s.refreshToken }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const next: Session = { ...s, accessToken: data.accessToken, refreshToken: data.refreshToken };
  await session.set(next);
  return next;
}

export const api = {
  async request<T>(path: string, opts: Opts = {}): Promise<T> {
    let s = await session.get();
    let res = await rawFetch(path, s, opts);
    if (res.status === 401 && s) {
      const refreshed = await tryRefresh(s);
      if (!refreshed) {
        await session.clear();
        throw new ApiError(401, 'Session expired — please log in again.');
      }
      s = refreshed;
      res = await rawFetch(path, s, opts);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
  },

  async login(host: string, identifier: string, password: string): Promise<Session> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Skoolos-Host': host },
      body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? 'Login failed — check your details.');
    }
    const data = await res.json(); // adjust field names to auth.service.ts if they differ
    const s: Session = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      role: data.user.role,
      schoolHost: host,
      displayName: data.user.name ?? data.user.email ?? identifier,
    };
    await session.set(s);
    await session.setSchoolHost(host);
    return s;
  },
};
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @skoolos/mobile test -- api.test`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/session.ts apps/mobile/src/lib/api.ts apps/mobile/src/lib/__tests__/api.test.ts
git commit -m "feat(mobile): session store and API client with tenant header + token refresh"
```

---

### Task 4: Connect-school + login screens, role → portal map

**Files:**
- Create: `apps/mobile/src/lib/roles.ts`
- Create: `apps/mobile/src/app/(auth)/connect.tsx`
- Create: `apps/mobile/src/app/(auth)/login.tsx`
- Modify: `apps/mobile/src/app/index.tsx` (bootstrap redirect)
- Test: `apps/mobile/src/lib/__tests__/roles.test.ts`

**Interfaces:**
- Produces: `portalForRole(role: Role): '/(family)/home' | '/(staff)/today'`; routes `/(auth)/connect`, `/(auth)/login`.

- [ ] **Step 1: Failing role-map test**

`apps/mobile/src/lib/__tests__/roles.test.ts`:

```ts
import { portalForRole } from '../roles';

it.each([
  ['STUDENT', '/(family)/home'],
  ['TEACHER', '/(staff)/today'],
  ['SCHOOL_ADMIN', '/(staff)/today'],
  ['STAFF', '/(staff)/today'],
] as const)('%s → %s', (role, path) => {
  expect(portalForRole(role)).toBe(path);
});

it('rejects OWNER (web-only)', () => {
  expect(() => portalForRole('OWNER')).toThrow(/web/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @skoolos/mobile test -- roles`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement roles.ts**

`apps/mobile/src/lib/roles.ts`:

```ts
import type { Role } from './session';

export function portalForRole(role: Role): '/(family)/home' | '/(staff)/today' {
  switch (role) {
    case 'STUDENT': return '/(family)/home';
    case 'TEACHER':
    case 'SCHOOL_ADMIN':
    case 'STAFF': return '/(staff)/today';
    case 'OWNER': throw new Error('Owner accounts use the web console.');
  }
}
```

Run: `pnpm --filter @skoolos/mobile test -- roles` → PASS.

- [ ] **Step 4: Screens**

`apps/mobile/src/app/(auth)/connect.tsx` — school code entry (stored as `<code>.sckools.com`):

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SckoolsLogo } from '@/components/SckoolsLogo';
import { session } from '@/lib/session';
import { tokens } from '@/theme/tokens';

export default function Connect() {
  const [code, setCode] = useState('');
  const valid = /^[a-z0-9-]{2,40}$/.test(code.trim().toLowerCase());

  const next = async () => {
    await session.setSchoolHost(`${code.trim().toLowerCase()}.sckools.com`);
    router.push('/(auth)/login');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: tokens.color.appBg, justifyContent: 'center', padding: 24, gap: tokens.gap }}>
      <View style={{ alignItems: 'center', marginBottom: 8 }}><SckoolsLogo size={44} /></View>
      <Text style={{ fontSize: 22, fontWeight: '800', color: tokens.color.ink, textAlign: 'center' }}>
        Connect your school
      </Text>
      <Text style={{ color: tokens.color.sub, textAlign: 'center' }}>
        Enter the school code from your school (e.g. “raffles”).
      </Text>
      <TextInput
        value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false}
        placeholder="school code" testID="school-code"
        style={{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line, borderWidth: 1,
          borderRadius: 14, padding: 14, fontSize: 16 }}
      />
      <Pressable disabled={!valid} onPress={next} testID="connect-btn"
        style={{ backgroundColor: tokens.color.indigo, opacity: valid ? 1 : 0.5, borderRadius: 14, padding: 15 }}>
        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 15 }}>Continue</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
```

`apps/mobile/src/app/(auth)/login.tsx`:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';
import { portalForRole } from '@/lib/roles';
import { tokens } from '@/theme/tokens';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const host = (await session.getSchoolHost())!;
      const s = await api.login(host, identifier.trim(), password);
      router.replace(portalForRole(s.role));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the school server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: tokens.color.appBg, justifyContent: 'center', padding: 24, gap: tokens.gap }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: tokens.color.ink }}>Log in</Text>
      <TextInput value={identifier} onChangeText={setIdentifier} placeholder="Email or admission number"
        autoCapitalize="none" testID="login-id"
        style={{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line, borderWidth: 1, borderRadius: 14, padding: 14 }} />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry testID="login-pw"
        style={{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line, borderWidth: 1, borderRadius: 14, padding: 14 }} />
      {error && <Text style={{ color: tokens.color.red }}>{error}</Text>}
      <Pressable onPress={submit} disabled={busy || !identifier || !password} testID="login-btn"
        style={{ backgroundColor: tokens.color.indigo, opacity: busy ? 0.6 : 1, borderRadius: 14, padding: 15 }}>
        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>{busy ? 'Logging in…' : 'Log in'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
```

Replace `apps/mobile/src/app/index.tsx` with the bootstrap redirect:

```tsx
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { session } from '@/lib/session';
import { portalForRole } from '@/lib/roles';

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const s = await session.get();
      if (s) { setTarget(portalForRole(s.role)); return; }
      setTarget((await session.getSchoolHost()) ? '/(auth)/login' : '/(auth)/connect');
    })();
  }, []);
  if (!target) return null;
  return <Redirect href={target as never} />;
}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @skoolos/mobile test` (all green) and `pnpm --filter @skoolos/mobile typecheck`.
Manual: `pnpm --filter @skoolos/mobile start`, walk connect → login against local API (`apps/api` running; use the Raffles seed tenant creds — see memory: logins are all `password`). Expect redirect to a not-yet-existing portal route (404 screen is fine — portals arrive in Task 5).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/roles.ts apps/mobile/src/lib/__tests__/roles.test.ts \
  "apps/mobile/src/app/(auth)/connect.tsx" "apps/mobile/src/app/(auth)/login.tsx" apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): connect-school + login flow with role-based portal routing"
```

---

### Task 5: Portal tab shells (family & staff) + shared UI primitives

**Files:**
- Create: `apps/mobile/src/components/ui.tsx` (Card, SectionTitle, Pill, Screen)
- Create: `apps/mobile/src/app/(family)/_layout.tsx`
- Create: `apps/mobile/src/app/(family)/home.tsx`, `attendance.tsx`, `notices.tsx`, `more.tsx`
- Create: `apps/mobile/src/app/(staff)/_layout.tsx`
- Create: `apps/mobile/src/app/(staff)/today.tsx`, `attendance.tsx`, `post.tsx`, `more.tsx`
- Test: `apps/mobile/src/components/__tests__/ui.test.tsx`

**Interfaces:**
- Produces: `<Screen>` (scrolling container applying the 11px gap rhythm), `<Card>`, `<SectionTitle title actionLabel? onAction?>`, `<Pill tone="green"|"red"|"amber"|"indigo"|"neutral">`; tab routes named exactly `home|attendance|notices|more` (family) and `today|attendance|post|more` (staff). Later tasks fill these screens — keep file names stable.

- [ ] **Step 1: Failing UI primitive test**

`apps/mobile/src/components/__tests__/ui.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card, Pill, Screen, SectionTitle } from '../ui';

it('Screen applies the 11px rhythm gap', () => {
  const { getByTestId } = render(<Screen><Text>x</Text></Screen>);
  const style = getByTestId('screen-scroll').props.contentContainerStyle;
  expect(style.gap).toBe(11);
});

it('Pill renders tone text', () => {
  const { getByText } = render(<Pill tone="green">Present</Pill>);
  expect(getByText('Present')).toBeTruthy();
});

it('SectionTitle shows title', () => {
  const { getByText } = render(<SectionTitle title="Quick actions" />);
  expect(getByText('Quick actions')).toBeTruthy();
});

it('Card renders children', () => {
  const { getByText } = render(<Card><Text>inside</Text></Card>);
  expect(getByText('inside')).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @skoolos/mobile test -- ui.test` → FAIL (module not found).

- [ ] **Step 3: Implement `ui.tsx`**

`apps/mobile/src/components/ui.tsx`:

```tsx
import type { PropsWithChildren } from 'react';
import { Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { tokens } from '@/theme/tokens';

export function Screen({ children }: PropsWithChildren) {
  return (
    <ScrollView
      testID="screen-scroll"
      style={{ flex: 1, backgroundColor: tokens.color.appBg }}
      contentContainerStyle={{ padding: 14, gap: tokens.gap, paddingBottom: 28 }}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return (
    <View style={[{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line,
      borderWidth: 1, borderRadius: tokens.radius.card, padding: 14 }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ title, actionLabel, onAction }:
  { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginHorizontal: 4, marginTop: 6, marginBottom: -3 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{title}</Text>
      {actionLabel && (
        <Pressable onPress={onAction}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: tokens.color.indigo }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const pillTones = {
  green: { bg: tokens.color.green50, fg: tokens.color.green },
  red: { bg: tokens.color.red50, fg: tokens.color.red },
  amber: { bg: tokens.color.amber50, fg: '#B45309' },
  indigo: { bg: tokens.color.indigo50, fg: tokens.color.indigo },
  neutral: { bg: '#F1F3F7', fg: tokens.color.sub },
} as const;

export function Pill({ tone, children }: PropsWithChildren<{ tone: keyof typeof pillTones }>) {
  const t = pillTones[tone];
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: tokens.radius.chip,
      paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.fg, fontSize: 11, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}
```

Run: `pnpm --filter @skoolos/mobile test -- ui.test` → 4 passed.

- [ ] **Step 4: Tab layouts + placeholder screens**

`apps/mobile/src/app/(family)/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router';
import { tokens } from '@/theme/tokens';

export default function FamilyTabs() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: tokens.color.indigo }}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Tabs.Screen name="notices" options={{ title: 'Notices' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
```

`apps/mobile/src/app/(staff)/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router';
import { tokens } from '@/theme/tokens';

export default function StaffTabs() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: tokens.color.indigo }}>
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Tabs.Screen name="post" options={{ title: 'Post' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
```

Each screen file starts as a placeholder using the primitives, e.g. `apps/mobile/src/app/(staff)/today.tsx`:

```tsx
import { Text } from 'react-native';
import { Card, Screen, SectionTitle } from '@/components/ui';

export default function Today() {
  return (
    <Screen>
      <SectionTitle title="Today" />
      <Card><Text>Coming in this build.</Text></Card>
    </Screen>
  );
}
```

Create the same placeholder pattern for: `(family)/home.tsx`, `(family)/attendance.tsx`, `(family)/notices.tsx`, `(family)/more.tsx`, `(staff)/attendance.tsx`, `(staff)/post.tsx`, `(staff)/more.tsx` (titles matching their tab).

- [ ] **Step 5: Verify** — `pnpm --filter @skoolos/mobile typecheck && pnpm --filter @skoolos/mobile test`. Manual: log in as teacher → staff tabs; as student → family tabs.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/ui.tsx apps/mobile/src/components/__tests__/ui.test.tsx \
  "apps/mobile/src/app/(family)" "apps/mobile/src/app/(staff)"
git commit -m "feat(mobile): family & staff tab shells with shared UI primitives"
```

---

### Task 6: API — teacher class list + attendance day-status (the lock, read side)

**Files:**
- Modify: `apps/api/src/modules/management/attendance.service.ts`
- Modify: `apps/api/src/modules/management/attendance.controller.ts`
- Test: `apps/api/src/modules/management/attendance-status.service.spec.ts` (new file)

**Interfaces:**
- Consumes: existing `AttendanceService.list/save`, `withTenant` from `@skoolos/db`, Prisma models `ClassSection`, `Teacher`, `Attendance`, `Student`, `User`.
- Produces:
  - `GET /manage/attendance/my-classes` → `Array<{ classSectionId: string; name: string; studentCount: number }>` — the sections where the caller is class teacher **or** has a timetable slot; `SCHOOL_ADMIN` gets all sections.
  - `GET /manage/attendance/status?date=YYYY-MM-DD` → `Array<{ classSectionId: string; name: string; total: number; present: number; taken: boolean; markedBy: string | null; markedAt: string | null }>` for those same classes. `taken = attendance rows exist for that section+date`; `markedBy` resolved from the earliest row's `markedById` → Teacher name (or `'School admin'` fallback).
- The existing uniqueness `@@unique([studentId, date])` remains the write-side lock; retake stays `PUT /manage/attendance` (service already replaces rows) — the mobile client provides the confirmation UX, and `save` already writes an `AuditLog` via existing patterns (verify; if not, add an `auditLog.create` in `save` recording prior counts).

- [ ] **Step 1: Read the neighbours** — `attendance.service.ts` (full), `attendance.service.spec.ts` (mock harness style), `management.dto.ts` (`AttendanceMarkDto` fields). Mirror their patterns exactly.

- [ ] **Step 2: Write failing service tests**

`apps/api/src/modules/management/attendance-status.service.spec.ts` — follow the mocking harness used in `attendance.service.spec.ts` (same `withTenant`/prisma mock setup). Cover, at minimum:

```ts
describe('AttendanceService.myClassSections', () => {
  it('returns sections where the user is class teacher or has timetable slots (deduped)', async () => {
    // seed mock: teacher linked to user; classTeacher of 5-B; timetable slot in 6-A and 5-B
    // expect: [{ 5-B }, { 6-A }] with studentCount from _count
  });
  it('returns all sections for SCHOOL_ADMIN', async () => {});
});

describe('AttendanceService.dayStatus', () => {
  it('marks taken=true with counts and marker name when rows exist', async () => {
    // seed: 5-B has 26 PRESENT + 2 ABSENT rows for date, markedById → Teacher "Priya Rao"
    // expect: { taken: true, total: 28, present: 26, markedBy: 'Priya Rao' }
  });
  it('marks taken=false with student total when no rows exist', async () => {});
});
```

Write them as real tests against the harness (not pseudocode) — copy the arrange helpers from the existing spec file.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter api test -- attendance-status`
Expected: FAIL — `myClassSections` / `dayStatus` do not exist.

- [ ] **Step 4: Implement service methods**

Add to `AttendanceService` (adapt tx model names to the file's existing style):

```ts
async myClassSections(schoolId: string, userId: string, role: string) {
  return withTenant(schoolId, async (tx) => {
    if (role === 'SCHOOL_ADMIN') {
      const all = await tx.classSection.findMany({
        select: { id: true, name: true, grade: { select: { name: true } }, _count: { select: { students: true } } },
        orderBy: { name: 'asc' },
      });
      return all.map((c) => ({ classSectionId: c.id, name: `${c.grade.name}-${c.name}`, studentCount: c._count.students }));
    }
    const teacher = await tx.teacher.findFirst({ where: { userId }, select: { id: true } });
    if (!teacher) return [];
    const sections = await tx.classSection.findMany({
      where: {
        OR: [
          { classTeacherId: teacher.id },
          { timetableSlots: { some: { teacherId: teacher.id } } },
        ],
      },
      select: { id: true, name: true, grade: { select: { name: true } }, _count: { select: { students: true } } },
      orderBy: { name: 'asc' },
    });
    return sections.map((c) => ({ classSectionId: c.id, name: `${c.grade.name}-${c.name}`, studentCount: c._count.students }));
  });
}

async dayStatus(schoolId: string, userId: string, role: string, date: string) {
  const classes = await this.myClassSections(schoolId, userId, role);
  return withTenant(schoolId, async (tx) => {
    const day = new Date(date);
    const out = [];
    for (const c of classes) {
      const rows = await tx.attendance.findMany({
        where: { classSectionId: c.classSectionId, date: day },
        select: { status: true, markedById: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      let markedBy: string | null = null;
      let markedAt: string | null = null;
      if (rows.length > 0) {
        markedAt = rows[0].createdAt.toISOString();
        const marker = await tx.teacher.findFirst({
          where: { id: rows[0].markedById },
          select: { firstName: true, lastName: true },
        });
        markedBy = marker ? `${marker.firstName} ${marker.lastName}` : 'School admin';
      }
      out.push({
        classSectionId: c.classSectionId,
        name: c.name,
        total: c.studentCount,
        present: rows.filter((r) => r.status === 'PRESENT').length,
        taken: rows.length > 0,
        markedBy,
        markedAt,
      });
    }
    return out;
  });
}
```

- [ ] **Step 5: Wire controller routes**

In `attendance.controller.ts` add (above the existing `@Get()` so the static paths match first):

```ts
@Get('my-classes')
myClasses(@CurrentUser() u: SchoolJwtPayload) {
  return this.attendance.myClassSections(this.sid(), u.sub, u.role);
}

@Get('status')
status(@CurrentUser() u: SchoolJwtPayload, @Query('date') date: string) {
  return this.attendance.dayStatus(this.sid(), u.sub, u.role, date);
}
```

(`SchoolJwtPayload` — confirm the role claim field name in `apps/api/src/common/auth/jwt-payload.ts`; adjust `u.role` accordingly.)

- [ ] **Step 6: Run tests**

Run: `pnpm --filter api test -- attendance`
Expected: new spec passes; existing `attendance.service.spec.ts` still green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/management/attendance.service.ts \
  apps/api/src/modules/management/attendance.controller.ts \
  apps/api/src/modules/management/attendance-status.service.spec.ts
git commit -m "feat(api): attendance day-status + teacher class list for mobile lock UX"
```

---

### Task 7: Mobile — teacher attendance (status list → take → retake with confirmation)

**Files:**
- Create: `apps/mobile/src/lib/attendance.ts` (types + payload builder)
- Modify: `apps/mobile/src/app/(staff)/attendance.tsx` (status list)
- Create: `apps/mobile/src/app/(staff)/take/[classSectionId].tsx` (roster + submit)
- Modify: `apps/mobile/src/app/(staff)/today.tsx` (status summary + pending CTA)
- Test: `apps/mobile/src/lib/__tests__/attendance.test.ts`

**Interfaces:**
- Consumes: `GET /manage/attendance/status?date=`, `GET /manage/attendance?classSectionId&date=` (roster+marks: `AttendanceMarkResult[]` — read `attendance.service.ts:list` for exact fields), `PUT /manage/attendance` with `{ classSectionId, date, marks: [{ studentId, status: 'PRESENT'|'ABSENT' }] }`.
- Produces: `buildMarksPayload(classSectionId, date, roster): SaveAttendanceDto`-shaped object; `todayISO(): string` (device-local YYYY-MM-DD).

- [ ] **Step 1: Failing payload-builder test**

`apps/mobile/src/lib/__tests__/attendance.test.ts`:

```ts
import { buildMarksPayload, todayISO } from '../attendance';

it('maps roster toggles to PUT payload', () => {
  const p = buildMarksPayload('cs1', '2026-07-24', [
    { studentId: 's1', present: true },
    { studentId: 's2', present: false },
  ]);
  expect(p).toEqual({
    classSectionId: 'cs1',
    date: '2026-07-24',
    marks: [
      { studentId: 's1', status: 'PRESENT' },
      { studentId: 's2', status: 'ABSENT' },
    ],
  });
});

it('todayISO returns YYYY-MM-DD', () => {
  expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @skoolos/mobile test -- attendance` → FAIL.

- [ ] **Step 3: Implement `attendance.ts`**

```ts
export interface ClassDayStatus {
  classSectionId: string; name: string; total: number; present: number;
  taken: boolean; markedBy: string | null; markedAt: string | null;
}

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildMarksPayload(
  classSectionId: string,
  date: string,
  roster: Array<{ studentId: string; present: boolean }>,
) {
  return {
    classSectionId,
    date,
    marks: roster.map((r) => ({ studentId: r.studentId, status: r.present ? 'PRESENT' : 'ABSENT' })),
  };
}
```

Run: `pnpm --filter @skoolos/mobile test -- attendance` → PASS.

- [ ] **Step 4: Status list screen**

`apps/mobile/src/app/(staff)/attendance.tsx` — per mockup: taken card (green pill `✓ 26/28 present`, "Taken in … by …", View/Retake buttons) vs pending card (amber, "Take attendance now"). Retake opens a native confirmation before navigating:

```tsx
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { todayISO, type ClassDayStatus } from '@/lib/attendance';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

export default function StaffAttendance() {
  const [rows, setRows] = useState<ClassDayStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    api.request<ClassDayStatus[]>(`/manage/attendance/status?date=${todayISO()}`)
      .then(setRows).catch((e) => setError(e.message));
  }, []));

  const confirmRetake = (c: ClassDayStatus) =>
    Alert.alert(
      `Retake attendance for ${c.name}?`,
      `${c.name} was already marked by ${c.markedBy ?? 'a teacher'} — ${c.present}/${c.total} present. ` +
      'Retaking overwrites the record for every teacher today. The previous version stays in the audit log.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retake', style: 'destructive',
          onPress: () => router.push(`/(staff)/take/${c.classSectionId}?name=${encodeURIComponent(c.name)}`) },
      ],
    );

  return (
    <Screen>
      <SectionTitle title="Attendance · today" />
      <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginHorizontal: 4 }}>
        One record per class per day. Once any teacher takes it, it locks for everyone — retake needs confirmation.
      </Text>
      {error && <Card><Text style={{ color: tokens.color.red }}>{error}</Text></Card>}
      {rows?.map((c) => (
        <Card key={c.classSectionId}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontWeight: '700', fontSize: 14, color: tokens.color.ink }}>{c.name}</Text>
              <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                {c.taken ? `Taken by ${c.markedBy ?? '—'}` : `${c.total} students · not taken yet`}
              </Text>
            </View>
            {c.taken
              ? <Pill tone="green">{`✓ ${c.present}/${c.total} present`}</Pill>
              : <Pill tone="amber">Pending</Pill>}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
            {c.taken ? (
              <Pressable onPress={() => confirmRetake(c)} testID={`retake-${c.classSectionId}`}
                style={{ flex: 1, backgroundColor: tokens.color.red50, borderRadius: 13, padding: 10 }}>
                <Text style={{ color: tokens.color.red, fontWeight: '700', textAlign: 'center', fontSize: 13 }}>Retake</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.push(`/(staff)/take/${c.classSectionId}?name=${encodeURIComponent(c.name)}`)}
                testID={`take-${c.classSectionId}`}
                style={{ flex: 1, backgroundColor: tokens.color.indigo, borderRadius: 13, padding: 11 }}>
                <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
                  Take attendance now
                </Text>
              </Pressable>
            )}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
```

- [ ] **Step 5: Take screen**

`apps/mobile/src/app/(staff)/take/[classSectionId].tsx` — fetch roster via `GET /manage/attendance?classSectionId=…&date=…` (map its result rows to `{ studentId, name, present }`, defaulting `present: true` when unmarked), Present/Absent toggle per student, live counts header, submit:

```tsx
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/api';
import { buildMarksPayload, todayISO } from '@/lib/attendance';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

interface RosterRow { studentId: string; name: string; present: boolean }

export default function TakeAttendance() {
  const { classSectionId, name } = useLocalSearchParams<{ classSectionId: string; name?: string }>();
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.request<Array<{ studentId: string; firstName: string; lastName: string; status?: string }>>(
      `/manage/attendance?classSectionId=${classSectionId}&date=${todayISO()}`,
    ).then((rows) => setRoster(rows.map((r) => ({
      studentId: r.studentId,
      name: `${r.firstName} ${r.lastName}`,
      present: r.status !== 'ABSENT',
    }))));
    // NOTE: adjust field names to AttendanceService.list's actual return shape.
  }, [classSectionId]);

  const presentCount = roster.filter((r) => r.present).length;

  const submit = async () => {
    setBusy(true);
    try {
      await api.request('/manage/attendance', {
        method: 'PUT',
        body: buildMarksPayload(classSectionId!, todayISO(), roster),
      });
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionTitle title={`${name ?? 'Class'} · Attendance`} />
      <Card>
        <Text style={{ fontWeight: '700', color: tokens.color.ink }}>
          {presentCount} present · {roster.length - presentCount} absent · {roster.length} total
        </Text>
      </Card>
      <Card style={{ paddingVertical: 2 }}>
        {roster.map((r) => (
          <View key={r.studentId} style={{ flexDirection: 'row', alignItems: 'center',
            paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: tokens.color.line }}>
            <Text style={{ flex: 1, fontWeight: '600', color: tokens.color.ink }}>{r.name}</Text>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F3F7', borderRadius: 10, padding: 3 }}>
              {(['Present', 'Absent'] as const).map((label) => {
                const on = label === 'Present' ? r.present : !r.present;
                const bg = on ? (label === 'Present' ? tokens.color.green : tokens.color.red) : 'transparent';
                return (
                  <Pressable key={label} testID={`${label.toLowerCase()}-${r.studentId}`}
                    onPress={() => setRoster((rs) => rs.map((x) =>
                      x.studentId === r.studentId ? { ...x, present: label === 'Present' } : x))}
                    style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: bg }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? '#fff' : tokens.color.sub }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </Card>
      <Pressable onPress={submit} disabled={busy || roster.length === 0} testID="submit-attendance"
        style={{ backgroundColor: tokens.color.indigo, borderRadius: 14, padding: 15, opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>
          {busy ? 'Submitting…' : 'Submit attendance'}
        </Text>
      </Pressable>
    </Screen>
  );
}
```

Also register the route group: create `apps/mobile/src/app/(staff)/take/_layout.tsx` returning a plain `<Stack />` if expo-router requires it (it does not for a nested folder — skip unless the route 404s).

- [ ] **Step 6: Update `today.tsx`** — replace placeholder with: greeting (from session `displayName`), the same `status` fetch, an alert-row per class (taken → green line, pending → amber CTA linking to take screen). Reuse `Card`/`Pill`; keep under 120 lines.

- [ ] **Step 7: Verify** — `pnpm --filter @skoolos/mobile test && pnpm --filter @skoolos/mobile typecheck`. Manual against local API + Raffles seed: take 5-B attendance as teacher X, log in as another teacher, confirm 5-B shows "Taken by …" with counts and Retake confirms before entering.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/lib/attendance.ts apps/mobile/src/lib/__tests__/attendance.test.ts "apps/mobile/src/app/(staff)"
git commit -m "feat(mobile): teacher attendance status, take & confirmed retake flow"
```

---

### Task 8: API — push tokens + Expo push notification channel

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add `PushToken`)
- Create: migration via prisma CLI
- Modify: `apps/api/src/modules/portal/portal.controller.ts` + `portal.service.ts` (register endpoint)
- Create: `apps/api/src/common/notifications/push.channel.ts`
- Modify: `apps/api/src/common/notifications/notification.module.ts` (add channel to `NOTIFICATION_CHANNELS`)
- Test: `apps/api/src/common/notifications/push.channel.spec.ts`

**Interfaces:**
- Consumes: existing `NotificationChannel` interface (`apps/api/src/common/notifications/notification.types.ts`) — `send(email: string, message: NotificationMessage): Promise<boolean>`; existing `format.ts` helpers for message text.
- Produces:
  - Prisma model `PushToken { id, schoolId, userId, email, token, platform, createdAt, lastSeenAt }`, `@@unique([token])`, `@@index([schoolId, email])`.
  - `POST /me/push-token` body `{ token: string; platform: 'android' | 'ios' }` (any authenticated school role) — upserts by token.
  - `PushChannel implements NotificationChannel` — looks up tokens by recipient email, sends via `expo-server-sdk` in chunks, deletes tokens on `DeviceNotRegistered`.

- [ ] **Step 1: Schema + migration**

Append to `packages/db/prisma/schema.prisma` (near `RefreshToken`):

```prisma
model PushToken {
  id         String   @id @default(uuid()) @db.Uuid
  schoolId   String   @db.Uuid
  userId     String   @db.Uuid
  email      String
  token      String   @unique
  platform   String
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
  school     School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId, email])
  @@index([userId])
}
```

Add the back-relation `pushTokens PushToken[]` to `model School`. Then:

```bash
pnpm --filter @skoolos/db exec prisma migrate dev --name push_tokens
```

(Requires `DIRECT_URL` in the db package env — see Global Constraints.)
Expected: migration created + applied; `prisma generate` run.

- [ ] **Step 2: Failing channel test**

`apps/api/src/common/notifications/push.channel.spec.ts` (mirror `email.channel.spec.ts` structure):

```ts
import { PushChannel } from './push.channel';

const send = jest.fn();
jest.mock('expo-server-sdk', () => ({
  Expo: Object.assign(
    jest.fn().mockImplementation(() => ({
      chunkPushNotifications: (msgs: unknown[]) => [msgs],
      sendPushNotificationsAsync: send,
    })),
    { isExpoPushToken: (t: string) => t.startsWith('ExponentPushToken') },
  ),
}));

const prisma = {
  pushToken: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const message = {
  kind: 'ABSENCE_NOTICE',
  payload: { studentName: 'Aarav Sharma', date: '2026-07-24', schoolName: 'Raffles Intl' },
} as never; // reuse a real kind + payload from notification.types.ts

it('sends to every registered token for the email', async () => {
  prisma.pushToken.findMany.mockResolvedValue([
    { token: 'ExponentPushToken[a]' }, { token: 'ExponentPushToken[b]' },
  ]);
  send.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }]);
  const ch = new PushChannel(prisma as never);
  expect(await ch.send('parent@x.com', message)).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});

it('returns false (not throws) when no tokens exist', async () => {
  prisma.pushToken.findMany.mockResolvedValue([]);
  const ch = new PushChannel(prisma as never);
  expect(await ch.send('parent@x.com', message)).toBe(false);
});

it('prunes DeviceNotRegistered tokens', async () => {
  prisma.pushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[dead]' }]);
  send.mockResolvedValue([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);
  const ch = new PushChannel(prisma as never);
  await ch.send('parent@x.com', message);
  expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
    where: { token: { in: ['ExponentPushToken[dead]'] } },
  });
});
```

Adjust the prisma injection to however the notifications module accesses the DB (check `notification.module.ts` imports — if channels are constructed with providers, inject the existing Prisma service; the test doubles stay the same shape).

- [ ] **Step 3: Run to verify failure** — `pnpm --filter api test -- push.channel` → FAIL (module not found).

- [ ] **Step 4: Implement**

```bash
pnpm --filter api add expo-server-sdk
```

`apps/api/src/common/notifications/push.channel.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';
import type { NotificationChannel, NotificationMessage } from './notification.types';
import { formatNotification } from './format'; // use the existing subject/body formatter; add one if absent

@Injectable()
export class PushChannel implements NotificationChannel {
  private readonly logger = new Logger(PushChannel.name);
  private readonly expo = new Expo();

  constructor(private readonly prisma: /* the project's Prisma service type */ any) {}

  async send(email: string, message: NotificationMessage): Promise<boolean> {
    const rows = await this.prisma.pushToken.findMany({
      where: { email },
      select: { token: true },
    });
    const tokens = rows.map((r: { token: string }) => r.token).filter((t: string) => Expo.isExpoPushToken(t));
    if (tokens.length === 0) return false;

    const { title, body } = formatNotification(message); // e.g. "Attendance update", "Aarav was marked absent today"
    const chunks = this.expo.chunkPushNotifications(
      tokens.map((to: string) => ({ to, sound: 'default', title, body })),
    );

    const dead: string[] = [];
    let ok = false;
    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((t, i) => {
          if (t.status === 'ok') ok = true;
          else if (t.details?.error === 'DeviceNotRegistered') dead.push((chunk[i] as { to: string }).to);
        });
      } catch (e) {
        this.logger.error('expo push chunk failed', e as Error);
      }
    }
    if (dead.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    }
    return ok;
  }
}
```

If `format.ts` has no generic `formatNotification`, add one there: a `switch (message.kind)` returning `{ title, body }` per existing kind (reuse the email templates' wording, shortened).

Register in `notification.module.ts`: add `PushChannel` to the `NOTIFICATION_CHANNELS` provider array (alongside the email channel) and to the module `providers`.

- [ ] **Step 5: Register endpoint**

`portal.controller.ts` — add:

```ts
@Post('push-token')
registerPushToken(
  @CurrentUser() u: SchoolJwtPayload,
  @Body() dto: RegisterPushTokenDto,
) {
  return this.portal.registerPushToken(u.sub, dto.token, dto.platform);
}
```

DTO (in the portal module's dto location, or inline file `portal.dto.ts`):

```ts
import { IsIn, IsString, Length } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString() @Length(10, 300)
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}
```

`portal.service.ts` — add (following the file's `withTenant`/tenant-resolution style; it derives `schoolId` from the user):

```ts
async registerPushToken(userId: string, token: string, platform: string) {
  const { schoolId, email } = await this.userSchoolAndEmail(userId); // reuse/extract the existing lookup used by profile()
  return withTenant(schoolId, (tx) =>
    tx.pushToken.upsert({
      where: { token },
      update: { userId, email, lastSeenAt: new Date() },
      create: { schoolId, userId, email, token, platform },
    }),
  );
}
```

**Important:** `/me/*` currently assumes STUDENT (`myStudent`). `registerPushToken` must NOT go through `myStudent` — it works for any role. If the controller has a role guard limiting to students, register the endpoint so TEACHER/STAFF/SCHOOL_ADMIN can call it too.

- [ ] **Step 6: Run tests** — `pnpm --filter api test -- "push.channel|portal"` → PASS (and existing portal spec still green).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations \
  apps/api/src/common/notifications/push.channel.ts apps/api/src/common/notifications/push.channel.spec.ts \
  apps/api/src/common/notifications/notification.module.ts apps/api/src/common/notifications/format.ts \
  apps/api/src/modules/portal apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): Expo push channel + device token registry"
```

---

### Task 9: Mobile — push permission + token registration

**Files:**
- Modify: `apps/mobile/package.json` (expo-notifications, expo-device)
- Create: `apps/mobile/src/lib/push.ts`
- Modify: `apps/mobile/src/app/(family)/_layout.tsx` and `(staff)/_layout.tsx` (register on mount)
- Test: `apps/mobile/src/lib/__tests__/push.test.ts`

**Interfaces:**
- Consumes: `POST /me/push-token` (Task 8).
- Produces: `registerForPush(): Promise<void>` — asks permission, gets Expo token, POSTs it; silent no-op on denial/emulator.

- [ ] **Step 1: Install**

```bash
pnpm --filter @skoolos/mobile exec npx expo install expo-notifications expo-device
```

- [ ] **Step 2: Failing test** (`push.test.ts`) — mock `expo-notifications` (`getPermissionsAsync`, `requestPermissionsAsync`, `getExpoPushTokenAsync`) and `@/lib/api`; assert: (a) POSTs `/me/push-token` with the token when granted; (b) does not call api when permission denied; (c) swallows api errors (resolves, no throw).

```ts
import { registerForPush } from '../push';
import { api } from '../api';

jest.mock('../api', () => ({ api: { request: jest.fn() } }));
jest.mock('expo-device', () => ({ isDevice: true }));
const perms = { status: 'granted' };
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => perms),
  requestPermissionsAsync: jest.fn(async () => perms),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[xyz]' })),
  setNotificationHandler: jest.fn(),
}));

it('registers the token when permission granted', async () => {
  await registerForPush();
  expect(api.request).toHaveBeenCalledWith('/me/push-token', {
    method: 'POST',
    body: { token: 'ExponentPushToken[xyz]', platform: expect.any(String) },
  });
});

it('never throws when the API call fails', async () => {
  (api.request as jest.Mock).mockRejectedValueOnce(new Error('down'));
  await expect(registerForPush()).resolves.toBeUndefined();
});
```

Run: `pnpm --filter @skoolos/mobile test -- push` → FAIL.

- [ ] **Step 3: Implement `push.ts`**

```ts
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
    shouldShowBanner: true, shouldShowList: true,
  }),
});

export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await api.request('/me/push-token', {
      method: 'POST',
      body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
  } catch {
    // best-effort — push must never break the app
  }
}
```

Run test → PASS.

- [ ] **Step 4: Call it from both portal layouts** — in each `_layout.tsx` add:

```tsx
import { useEffect } from 'react';
import { registerForPush } from '@/lib/push';
// inside the component body:
useEffect(() => { void registerForPush(); }, []);
```

- [ ] **Step 5: Manual verification** — needs a dev build (remote push doesn't work in Expo Go on SDK 53): defer device verification to Task 14's first EAS build; for now assert the POST fires (check API logs) when running on a real device via `expo run:android` if available.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/lib/push.ts apps/mobile/src/lib/__tests__/push.test.ts \
  "apps/mobile/src/app/(family)/_layout.tssx" "apps/mobile/src/app/(staff)/_layout.tsx" pnpm-lock.yaml
git commit -m "feat(mobile): push permission flow + token registration"
```

(Fix the `.tssx` typo when staging — the path is `_layout.tsx`.)

---

### Task 10: API — teacher announcements to multiple classes + push fan-out

**Files:**
- Modify: `apps/api/src/modules/management/management.dto.ts` (`CreateAnnouncementDto`)
- Modify: `apps/api/src/modules/management/announcements.controller.ts` (allow TEACHER)
- Modify: `apps/api/src/modules/management/announcements.service.ts`
- Modify: `apps/api/src/common/notifications/notification.types.ts` + `format.ts` (add `ANNOUNCEMENT` kind if absent)
- Test: `apps/api/src/modules/management/announcements-teacher.spec.ts`

**Interfaces:**
- Consumes: `AttendanceService.myClassSections` (Task 6) for the teacher-ownership check; `NotificationService.notify` (existing); `runInBackground` helper (existing, see `run-in-background.ts`).
- Produces: `POST /manage/announcements` now accepts `{ title, body, classSectionIds?: string[] }`; teacher may only target classSectionIds within their own class list (else 403); `SCHOOL_ADMIN` may pass `[]`/omit for whole-school (existing `classSectionId: null` behavior). One `Announcement` row per class section. After create, fan out `ANNOUNCEMENT` notifications to affected students'/guardians' emails (reuse the recipient-resolution helpers in `recipients.ts`).

- [ ] **Step 1: Read the neighbours** — `announcements.service.ts` and `recipients.ts` in full; note how absence notices resolve guardian emails per student, and copy that approach for "all students in section X".

- [ ] **Step 2: Failing tests** (`announcements-teacher.spec.ts`, harness copied from an existing management spec):

```ts
describe('teacher announcement create', () => {
  it('creates one announcement row per targeted class section', async () => {});
  it('403s when a teacher targets a class that is not theirs', async () => {});
  it('SCHOOL_ADMIN may create a whole-school announcement (classSectionId null)', async () => {});
  it('enqueues ANNOUNCEMENT notifications for recipients of targeted classes', async () => {});
});
```

Write all four as real tests before implementing.

- [ ] **Step 3: Run to verify failure** — `pnpm --filter api test -- announcements-teacher` → FAIL.

- [ ] **Step 4: Implement**

`management.dto.ts` — extend:

```ts
export class CreateAnnouncementDto {
  @IsString() @Length(1, 160)
  title!: string;

  @IsString() @Length(1, 4000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  classSectionIds?: string[];
}
```

`announcements.controller.ts` — change class-level `@Roles('SCHOOL_ADMIN')` so GET stays as-is but create allows teachers: move roles to method level — `@Roles('SCHOOL_ADMIN', 'TEACHER')` on `create`, `@Roles('SCHOOL_ADMIN')` on update/delete/list-admin (match the file's current structure).

`announcements.service.ts` — in `create`, when the caller is TEACHER: resolve their sections via `AttendanceService.myClassSections` (inject it, or extract that query into a small shared `TeacherScopeService` if module wiring makes injection awkward — keep it one query, not a new abstraction layer). Validate every requested id is in the set; create one row per id inside a single `withTenant` transaction; then, in the existing background-notify pattern (`runInBackground`), resolve recipients per section and `notify('ANNOUNCEMENT', recipients)`.

`notification.types.ts` — add to the payload map (if not present):

```ts
ANNOUNCEMENT: { title: string; body: string; schoolName: string; className: string | null };
```

`format.ts` — case for it: title `📣 ${payload.schoolName}`, body `${payload.title} — ${payload.body.slice(0, 120)}`.

- [ ] **Step 5: Run tests** — `pnpm --filter api test -- announcements` → all green (including any pre-existing announcements spec).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/management/management.dto.ts \
  apps/api/src/modules/management/announcements.controller.ts \
  apps/api/src/modules/management/announcements.service.ts \
  apps/api/src/modules/management/announcements-teacher.spec.ts \
  apps/api/src/common/notifications/notification.types.ts apps/api/src/common/notifications/format.ts
git commit -m "feat(api): teacher multi-class announcements with push fan-out"
```

---

### Task 11: Mobile — Post screen (multi-class chips), family Home / Notices / Attendance

**Files:**
- Modify: `apps/mobile/src/app/(staff)/post.tsx`
- Modify: `apps/mobile/src/app/(family)/home.tsx`, `(family)/notices.tsx`, `(family)/attendance.tsx`
- Create: `apps/mobile/src/components/ClassChips.tsx`
- Test: `apps/mobile/src/components/__tests__/ClassChips.test.tsx`

**Interfaces:**
- Consumes: `GET /manage/attendance/my-classes`, `POST /manage/announcements`, `GET /me/announcements`, `GET /me/attendance?month=YYYY-MM` (read `portal.service.ts:attendance` for the exact `AttendanceSummary` shape before coding the calendar), `GET /me/profile`.
- Produces: `<ClassChips classes selected onChange />` — multi-select chips, per the mockup (each toggles independently; selected shows ✓; P1 has no whole-school chip for teachers).

- [ ] **Step 1: Failing ClassChips test**

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import { ClassChips } from '../ClassChips';

const classes = [
  { classSectionId: 'a', name: 'Grade 5-B' },
  { classSectionId: 'b', name: 'Grade 6-A' },
];

it('toggles selection on tap', () => {
  const onChange = jest.fn();
  const { getByText } = render(<ClassChips classes={classes} selected={['a']} onChange={onChange} />);
  fireEvent.press(getByText('Grade 6-A'));
  expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  fireEvent.press(getByText(/Grade 5-B/));
  expect(onChange).toHaveBeenCalledWith([]);
});
```

Run → FAIL. Implement:

```tsx
import { Pressable, Text, View } from 'react-native';
import { tokens } from '@/theme/tokens';

interface ClassRef { classSectionId: string; name: string }

export function ClassChips({ classes, selected, onChange }:
  { classes: ClassRef[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {classes.map((c) => {
        const on = selected.includes(c.classSectionId);
        return (
          <Pressable key={c.classSectionId} onPress={() => toggle(c.classSectionId)}
            style={{ borderWidth: 1.5, borderColor: on ? tokens.color.indigo : tokens.color.line,
              backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
              borderRadius: 11, paddingVertical: 9, paddingHorizontal: 13 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '700',
              color: on ? tokens.color.indigo : tokens.color.sub }}>
              {on ? `✓ ${c.name}` : c.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

Run → PASS.

- [ ] **Step 2: Post screen** — `post.tsx`: fetch my-classes on focus; `ClassChips` + Title/Details inputs + submit button labelled `Post to N class(es)` (disabled at 0), POST `{ title, body, classSectionIds }`, success clears the form and shows a brief confirmation `Text`. Follow the mockup copy ("Send to — tap to select multiple").

- [ ] **Step 3: Family notices** — `notices.tsx`: fetch `/me/announcements`, render alert-rows (title, class/school scope line, relative time). Empty state: "No notices yet — school updates will appear here."

- [ ] **Step 4: Family attendance** — `attendance.tsx`: fetch `/me/attendance?month=` for the current month; stat row (Present %, Absences, School days) + a simple month grid colored per status (`green50/red50/#F1F3F7`), matching the mockup calendar. Map fields from the actual `AttendanceSummary` type in `portal.service.ts`.

- [ ] **Step 5: Family home** — `home.tsx`: fetch `/me/profile` + announcements; render the child status card (name, class, today's attendance state), "Needs your attention" alert-rows (latest notice, absence if today ABSENT), quick-action grid of 4 (Attendance, Notices, Holidays, Timetable→toast "coming soon"). Keep to the mockup's structure; skip streak/quiz (P3).

- [ ] **Step 6: Verify** — full `pnpm --filter @skoolos/mobile test && typecheck`; manual walkthrough of the trust loop end-to-end locally: teacher posts + takes attendance → student app shows both; API log shows notification fan-out.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/components/ClassChips.tsx apps/mobile/src/components/__tests__/ClassChips.test.tsx \
  "apps/mobile/src/app/(staff)/post.tsx" "apps/mobile/src/app/(family)"
git commit -m "feat(mobile): teacher multi-class post + family home, notices, attendance"
```

---

### Task 12: Holidays end-to-end (model → API → both portals)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Holiday model) + migration
- Create: `apps/api/src/modules/management/holidays.controller.ts`, `holidays.service.ts`
- Modify: `apps/api/src/modules/management/management.module.ts`, `management.dto.ts`
- Modify: `apps/api/src/modules/portal/portal.controller.ts` + `portal.service.ts` (`GET /me/holidays`)
- Create: `apps/mobile/src/app/(family)/holidays.tsx` *(registered under More)* and `apps/mobile/src/app/(staff)/holidays.tsx`
- Test: `apps/api/src/modules/management/holidays.service.spec.ts`

**Interfaces:**
- Produces:
  - Prisma: `model Holiday { id, schoolId, name, type ('PUBLIC'|'FESTIVAL'|'SCHOOL' as String), startDate @db.Date, endDate DateTime? @db.Date, createdAt }`, `@@index([schoolId, startDate])`, School back-relation.
  - `GET/POST/DELETE /manage/holidays` (SCHOOL_ADMIN) — list upcoming, create `{ name, type, startDate, endDate? }`, delete by id.
  - `GET /me/holidays` (any school role) → upcoming holidays ordered by startDate.

- [ ] **Step 1: Schema + migration**

```bash
pnpm --filter @skoolos/db exec prisma migrate dev --name holidays
```

- [ ] **Step 2: Failing service tests** — `holidays.service.spec.ts`: create validates type; list returns only `startDate >= today` ordered ascending; delete removes. Real tests, existing harness style.

- [ ] **Step 3: Implement service + controller** (thin CRUD following any existing simple management pair, e.g. announcements). DTO:

```ts
export class CreateHolidayDto {
  @IsString() @Length(1, 120) name!: string;
  @IsIn(['PUBLIC', 'FESTIVAL', 'SCHOOL']) type!: string;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
}
```

`GET /me/holidays` in portal: any role — same caution as Task 8 (`myStudent` must not gate it); returns `{ id, name, type, startDate, endDate }[]`.

- [ ] **Step 4: Run tests** — `pnpm --filter api test -- holidays` → PASS.

- [ ] **Step 5: Mobile screens** — both portals: a `holidays.tsx` screen rendering the mockup's date-chip rows (day-number block, name, weekday, type Pill: PUBLIC→green, FESTIVAL→amber, SCHOOL→indigo) + the caption "Configured by your school admin on the web portal." Family: link from More + home quick action; Staff: link from More. (Register in More via a simple `router.push('/(family)/holidays')` list row; the file living in the tab group but hidden from the tab bar: add `<Tabs.Screen name="holidays" options={{ href: null }} />` in each `_layout.tsx`.)

- [ ] **Step 6: Verify + commit**

```bash
pnpm --filter api test && pnpm --filter @skoolos/mobile typecheck
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations \
  apps/api/src/modules/management/holidays.controller.ts apps/api/src/modules/management/holidays.service.ts \
  apps/api/src/modules/management/holidays.service.spec.ts apps/api/src/modules/management/management.module.ts \
  apps/api/src/modules/management/management.dto.ts apps/api/src/modules/portal \
  "apps/mobile/src/app/(family)/holidays.tsx" "apps/mobile/src/app/(staff)/holidays.tsx" \
  "apps/mobile/src/app/(family)/_layout.tsx" "apps/mobile/src/app/(staff)/_layout.tsx" \
  "apps/mobile/src/app/(family)/more.tsx" "apps/mobile/src/app/(staff)/more.tsx"
git commit -m "feat: holidays — model, admin CRUD API, /me/holidays, mobile screens"
```

---

### Task 13: Maestro E2E flows + turbo/CI wiring

**Files:**
- Create: `apps/mobile/.maestro/login-teacher.yaml`
- Create: `apps/mobile/.maestro/attendance-trust-loop.yaml`
- Modify: `turbo.json` (mobile `test`/`typecheck` in the pipeline)

**Interfaces:**
- Consumes: testIDs added in Tasks 4/7 (`school-code`, `connect-btn`, `login-id`, `login-pw`, `login-btn`, `take-*`, `present-*`, `submit-attendance`).

- [ ] **Step 1: Install Maestro locally** — `curl -Ls https://get.maestro.mobile.dev | bash` (document in the yaml header comment; CI can come later).

- [ ] **Step 2: Login flow**

`apps/mobile/.maestro/login-teacher.yaml`:

```yaml
appId: com.sckools.app
---
- launchApp
- tapOn:
    id: school-code
- inputText: "raffles"
- tapOn:
    id: connect-btn
- tapOn:
    id: login-id
- inputText: "${TEACHER_EMAIL}"
- tapOn:
    id: login-pw
- inputText: "${TEACHER_PASSWORD}"
- tapOn:
    id: login-btn
- assertVisible: "Today"
```

- [ ] **Step 3: Trust-loop flow** — `attendance-trust-loop.yaml`: from logged-in teacher, open Attendance tab, tap a pending class's `take-*`, toggle one student Absent, `submit-attendance`, assert the class row now shows "present". Write the yaml fully with the same command style as above.

- [ ] **Step 4: Turbo wiring** — in `turbo.json`, ensure `test` and `typecheck` tasks include the mobile package (match the repo's existing pipeline layout; usually nothing to add if tasks are defined generically — verify with `pnpm turbo run typecheck --filter @skoolos/mobile --dry`).

- [ ] **Step 5: Run flows** against a dev build on emulator with the seeded API: `maestro test apps/mobile/.maestro/login-teacher.yaml` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/.maestro turbo.json
git commit -m "test(mobile): Maestro E2E for login and attendance trust loop"
```

---

### Task 14: App icons, EAS build profile, first `.aab`, Play runbook

**Files:**
- Create: `apps/mobile/assets/icon.png`, `apps/mobile/assets/adaptive-icon.png`, `apps/mobile/assets/splash.png`
- Modify: `apps/mobile/app.config.ts` (icon/splash + EAS projectId + runtimeVersion)
- Create: `apps/mobile/eas.json`
- Create: `docs/SHIP-MOBILE.md`

**Interfaces:**
- Consumes: Tassel-S SVG (`apps/web/components/brand/sckools-logo.tsx` paths).
- Produces: a production `.aab` on EAS; `docs/SHIP-MOBILE.md` runbook the user follows in the Play Console.

- [ ] **Step 1: Generate icons** — render the Tassel-S symbol (indigo stroke, amber tassel on white; adaptive foreground = symbol on transparent, background `#4F46E5` set in config) at 1024×1024. Use the repo's existing icon assets under `apps/web/public` as reference for tone; produce PNGs with any local tool (e.g. `rsvg-convert`/`sharp` one-off script — a throwaway script in the scratchpad is fine, do not commit it). Wire in `app.config.ts`:

```ts
icon: './assets/icon.png',
splash: { image: './assets/splash.png', backgroundColor: '#F4F5FB', resizeMode: 'contain' },
android: {
  package: 'com.sckools.app',
  adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#4F46E5' },
},
```

- [ ] **Step 2: EAS setup**

```bash
pnpm --filter @skoolos/mobile exec npx eas-cli login       # user's Expo account
pnpm --filter @skoolos/mobile exec npx eas-cli init        # writes projectId into app config
```

`apps/mobile/eas.json`:

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "internal": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://<staging-api-host>" }
    },
    "production": {
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" },
      "env": { "EXPO_PUBLIC_API_URL": "https://<prod-api-host>" }
    }
  },
  "submit": { "production": {} }
}
```

Fill the two API hosts from the deployed environments (see memory "SkoolOS Vercel deploy facts" / staging env note). Add `updates` + `runtimeVersion: { policy: 'appVersion' }` to `app.config.ts` for EAS Update.

- [ ] **Step 3: Build**

```bash
pnpm --filter @skoolos/mobile exec npx eas-cli build -p android --profile production
```

Expected: build succeeds on EAS; download URL for the `.aab`. Also run an `internal` APK build and install it on a physical device — verify login + push (send a test via `https://expo.dev/notifications` with the device's token, then verify the real flow: mark a student absent → guardian-email-linked account's device receives the push).

- [ ] **Step 4: Write `docs/SHIP-MOBILE.md`** — the console runbook, verbatim steps: create app entry (if the registered package differs, reconcile) → Testing → Internal testing → upload `.aab` → verify install → Closed testing track → create Google Group, add 12 testers → paste opt-in link into the group → confirm all 12 opted in (clock starts) → complete Data safety + privacy policy (`https://sckools.com/privacy` — page must exist; add to web if missing, flag to user) + content rating + target audience → after 14 days: Apply for production access → staged rollout 10/50/100. Include the EAS Update command for daily tester pushes: `eas update --branch production --message "…"`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/assets apps/mobile/app.config.ts apps/mobile/eas.json docs/SHIP-MOBILE.md
git commit -m "feat(mobile): brand assets, EAS build profiles, Play Console ship runbook"
```

---

## Self-Review (performed)

- **Spec coverage (P1 rows):** auth+role routing (T3–T5), push pipeline (T8–T9), attendance lock/retake (T6–T7), notices post+feed (T10–T11), family attendance view (T11), holidays (T12), app shell (T5), `.aab` + closed test (T14), E2E (T13). Deferred by design: memberships/OTP global accounts (P2 migration — P1 uses existing per-school credentials + school-code connect), capability presets beyond the role map (P1 uses the existing role enum), quiz/fees/marks (P2/P3).
- **Type consistency:** `Session`/`Role` (T3) consumed by T4/T5/T7; `ClassDayStatus` (T7) matches T6's endpoint shape; `buildMarksPayload` output matches `SaveAttendanceDto`; `ClassChips` props match `my-classes` response.
- **Known adjust-on-read points (explicitly marked in tasks):** auth response field names (T3 Step 1), `AttendanceService.list` row shape (T7), notifications module Prisma injection (T8), `AttendanceSummary` shape (T11), jwt payload role claim (T6). Each task instructs reading the exact file first.
