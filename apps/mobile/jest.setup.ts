import { configure } from '@testing-library/react-native';

/**
 * Raise React Native Testing Library's async timeout to match this suite's
 * own convention.
 *
 * `findBy*` and `waitFor` do NOT inherit jest's `testTimeout` (45s here) —
 * they carry a separate `asyncUtilTimeout` that defaults to 1000ms. So a
 * screen that renders, fetches, and re-renders has one second to finish
 * regardless of how patient the test itself is, and under a loaded machine
 * (the full 84-file suite, or turbo running several packages at once) that
 * cliff is reachable while nothing is actually wrong.
 *
 * 30 test files use a bare `findBy*`. At least one — assignments.test.tsx —
 * had already worked around this locally with its own
 * `waitFor(..., { timeout: 8000 })` helper, which is the same fix applied by
 * hand in one place. This makes it the default so the next screen test does
 * not have to rediscover it.
 *
 * This does NOT make a genuinely broken test pass: a screen that never
 * renders the text still fails, just after 8s instead of 1s. What it removes
 * is a failure mode that reports a timing artifact as a product defect.
 */
configure({ asyncUtilTimeout: 8000 });
