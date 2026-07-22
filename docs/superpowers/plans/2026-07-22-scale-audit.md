# Scale & Latency Audit (2026-07-22)
Target: ~5,000 schools × 500 students × 50 teachers = 2.5M students, 250k teachers, ~500M attendance rows/yr.
Every tenant request is scoped to ONE school (~500 students / ~50 teachers / ~24 classes) → bounded. The risks below are the exceptions.

## 🔴 CRITICAL — cross-tenant full-table scans (owner)
**owner-overview.service.ts `overview()`** — runs `student.groupBy(by:schoolId)`, `mediaAsset.groupBy ×2`, `enquiry.groupBy ×2`, `event.groupBy` with NO time bound and NO cache. Each scans its ENTIRE table across all schools (2.5M students, millions of images) to produce ~5,000 counts. At scale = multi-second, hammers DB, blocks the owner console.
- **Fix 1 (cheap, now):** Redis-cache the whole payload, TTL 2–5 min (owner data isn't real-time). ~1 line of work, removes ~all repeat cost. ✅ implementing.
- **Fix 2 (scalable):** denormalized per-school counters (`School.studentCount`, `imageCount`) maintained on insert/delete (or a nightly rollup table). Overview then reads 5,000 pre-computed rows, never scans millions. Larger — recommended before ~500 schools.
- **Fix 3:** paginate `GET /owner/schools` (returning 5,000 rows is wasteful).

## 🟠 HIGH — N+1 write loops on daily hot paths
1. **attendance.service.ts `save()`** — `for (mark of marks) await tx.attendance.upsert()`: ~40 sequential round-trips per class, inside a txn, EVERY day for EVERY class. At scale this holds a pooled connection 40× latency and serializes. **Fix: `deleteMany({studentId in ids, date}) + createMany(rows)` → 2 queries.** The newly-absent diff already reads `before` up front, so batching is safe. ✅ implementing.
2. **exams.service.ts `saveResults()`** — same per-student `result.upsert` loop (~40/exam). Same batch fix. ✅ implementing.

## 🟡 MEDIUM
3. **students.service.ts `list()`** — no server-side pagination; returns all ~500 + UI renders 500 rows. Add `take/skip/page` + `count`, paginate UI. (Flagged earlier as P2-F.)
4. **Timetable versioned read** — filter `effectiveFrom<=asOf AND (effectiveTo IS NULL OR >asOf)`. Indexed by `(schoolId,classSectionId,effectiveFrom)`; effectiveTo not indexed but per-class version count is tiny — fine now. Watch if versions accumulate heavily.
5. **login flow** — login POST → `/auth/me`, then `/app` layout fetches `/auth/me` AGAIN. Dedup (pass role/features from login, or cache the me-query). Minor.

## 🟢 GOOD (already optimized — no action)
- Tenant/host resolution: Redis-cached (60s). ✓
- Feature resolver (/auth/me): Redis-cached. ✓
- portal results, availability, staff-attendance roster: batched (Promise.all + in-memory maps). ✓
- withTenant transactions, tenant-scoped indexed queries, no cross-tenant fan-out in tenant APIs. ✓

## 🔵 Redis caching opportunities (high-read, low-change)
- **owner-overview** (2–5 min) — ✅ doing now.
- **Recurring timetable per (school, classSection, asOf-version)** — read by every teacher/student/admin; changes rarely. Cache + invalidate on assign/publish/substitution/leave. Big read win.
- **Periods + workingDays per school**, **subjects/grades per school** — near-static, read on many screens. Cache with invalidation on edit.

## Algo notes (DSA)
- In-memory joins use O(n) Map lookups — correct. No O(n²) hot loops found.
- Batching the two N+1 loops changes O(n) round-trips → O(1) queries — the main algorithmic win.
