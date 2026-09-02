-- History for the ops dashboard.
--
-- Metrics lived only in Redis with a 2-hour expiry, so the page could say how
-- things are right now but not whether they are getting worse — and "getting
-- worse" is the signal that catches a limit before it is reached.
--
-- Hourly rows, not per-minute: ~600 a day against 36,000, and trend does not
-- need minute resolution. The live view still reads Redis directly.
CREATE TABLE "MetricRollup" (
  "hour"         TIMESTAMP(3) NOT NULL,
  "route"        TEXT NOT NULL,
  "count"        INTEGER NOT NULL DEFAULT 0,
  "errors"       INTEGER NOT NULL DEFAULT 0,
  "txTimeouts"   INTEGER NOT NULL DEFAULT 0,
  "poolTimeouts" INTEGER NOT NULL DEFAULT 0,
  "latency"      INTEGER[] NOT NULL,
  "dbHold"       INTEGER[] NOT NULL,
  CONSTRAINT "MetricRollup_pkey" PRIMARY KEY ("hour", "route")
);

CREATE INDEX "MetricRollup_hour_idx" ON "MetricRollup" ("hour");

-- Platform-wide operational data, not tenant data: there is no schoolId to
-- scope by, and only the owner console reads it. RLS would have nothing to
-- compare against, so the table is deliberately left out of tenant isolation
-- and the platform role is the only grantee.
GRANT SELECT, INSERT, UPDATE, DELETE ON "MetricRollup" TO skoolos_platform;
