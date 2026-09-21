# Page audit

    node scripts/audit/page-audit.mjs

Grades every page in `apps/web/app` and writes the result to `log/`.

## The grades mean something specific

| | |
|---|---|
| **PERFECT** | Every check ran and found nothing. Not "unexamined" — checked and clean. |
| **MODERATE** | Works today, carries a known cost that grows with the data. |
| **BROKEN** | A person can reach this and be stuck or misled. The script exits 1. |

## The rules are incidents, not taste

Every rule in `checks.mjs` is there because a real screen shipped with it, and
the comment above each one says which. A rule with no incident behind it does
not belong in the file — that is what keeps the MODERATE list worth reading.

Two rules were narrowed after their first run, for the same reason: matching a
word anywhere on a line flagged one student's three invoices as roster-scale
work. **A rule that cries wolf makes the whole audit ignorable**, which is worse
than not having the rule.

## Bundle sizes

The `heavy-bundle` check needs a production build:

    cd apps/web && npx next build > ../../scripts/audit/build.log 2>&1

Without `build.log` the run says the check was **skipped** rather than quietly
grading on six rules instead of seven.

## The log is the point

`log/latest.json` holds the last run; `log/<date>.json` keeps the history. Each
run diffs against the previous one and prints what changed, so a page that was
PERFECT last week and is not today shows up as a **regression** rather than as
somebody's new opinion. That is the whole reason this is a script and not a
conversation.
