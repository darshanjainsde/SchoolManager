# Device audit: the app as people see it

Unit tests cannot show what a phone draws. The keyboard covering a form, rows
scrolling through the status bar, two screens disagreeing about today: every
one of these passed jest and was only found by running the RELEASE build on an
emulator (2026-10-08). These scripts make that walk repeatable.

| Script | What it does |
|---|---|
| `crawl.py <role> <login>` | Clears the app, logs in, opens every tab (3 scroll positions) and every Home tool, screenshots each, and saves the JS warnings/errors from logcat. |
| `probe.py <name> <input> [button…]` | Focuses a box and reports whether it and its buttons sit above the keyboard. |
| `ui.py tap/type/key/dump/find/reveal/shot/ime` | The small adb + uiautomator driver the other two use. |
| `sheet.py <dir> [per]` | Joins screenshots into contact sheets for review (needs Pillow). |
| `screens.mjs` | Writes the screen inventory (route, role, API calls, components) as JSON. |

Output goes to `$AUDIT_OUT` (default `/tmp/sckools-audit`), never into the repo.

## Recipe

1. **Build a local release APK** against a local API. The worktree needs
   EAS's layout first: `NPM_CONFIG_NODE_LINKER=hoisted pnpm install`. Then:
   ```sh
   cd apps/mobile
   EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 npx expo prebuild --platform android --clean
   # local only: let the release build talk plain http to 10.0.2.2
   sed -i '' 's/<application /<application android:usesCleartextTraffic="true" /' android/app/src/main/AndroidManifest.xml
   cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
   ```
   If the JS bundle step fails with `readlink EINVAL … apps/web/node_modules/sharp`,
   move `apps/web/node_modules` aside for the build.
2. **Run the API** on the sample-pack database (`skoolos_pack`, every login's
   password is `password`): `node --require ts-node/register/transpile-only
   --require tsconfig-paths/register src/main.ts` with `REDIS_URL` and dummy
   `S3_*` set (the env schema requires them).
3. **Boot an emulator**: an API 36 phone (Android 16), and API 34 for
   comparison. Turn animations off (uiautomator needs an idle screen) and turn
   stylus handwriting off.
4. **Walk every role:**
   ```sh
   DEV=emulator-5556 python3 crawl.py teacher rekha.sinha@sample.school
   DEV=emulator-5556 python3 crawl.py student sps-00600@students.sample.school
   DEV=emulator-5556 python3 crawl.py librarian ramesh.pawar@sample.school
   DEV=emulator-5556 python3 crawl.py accounts meera.joshi@sample.school
   DEV=emulator-5556 python3 crawl.py sports latha.shinde@sample.school   # Staff.role=SPORTS + SPORTS feature
   DEV=emulator-5556 python3 crawl.py office sunita.kale@sample.school
   ```
   The sample school's PRO plan does not include SPORTS or SALARY. Turn them
   on with `FeatureOverride` rows in the LOCAL database to see those desks.

## Rules learned the hard way

- Judge the release build, not Expo Go or a debug build.
- Tap the keyboard's OWN Next/Go key. `adb shell input keyevent 66` is a
  hardware Enter: it closes the keyboard where the real key does not.
- Look at every screen scrolled, not only at rest.
- The standards are in the global `android-ui-ledger` skill. The per-screen
  map is in the `sckools-app-screens` skill.
