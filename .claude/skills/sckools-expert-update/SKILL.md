---
name: sckools-expert-update
description: Refresh the sckools-expert knowledge base after shipping or learning something — regenerates the machine-derived inventories from the current tree, lists every commit and touched area since the last stamp, updates the curated references and changelog, verifies every cited path still exists, and syncs the skill to the project's .claude directory. Run it at the end of any feature, migration, deploy-process or pricing change.
---

# Update the Sckools Expert

The expert skill lives at `.claude/skills/sckools-expert/` (in the repository, so it ships with the code) and is
mirrored into the project checkout Claude Code loads. This procedure keeps both current. Do all of it; the
inventories are the cheap part, the narrative is what makes the skill worth reading.

## 0. Pick the tree to document

Document the branch being shipped (`staging` or a feature branch cut from `origin/main`), **never the stale local
checkout**. `git fetch origin` first. Let `ROOT` be that worktree (e.g. `/Users/darshanjain/Worktrees/<name>`).

## 1. Regenerate the inventories

```bash
node $ROOT/.claude/skills/sckools-expert/scripts/inventory.mjs --root $ROOT
```

Writes `references/inventory/{STATE.json,data-model,api-routes,web-routes,mobile-routes,features,notifications,migrations,workflows,packages,env,docs-index}.md`. If the script errors on a new decorator or schema shape, fix the parser — do not hand-edit an inventory file.

## 2. See what changed since the last stamp

```bash
node $ROOT/.claude/skills/sckools-expert/scripts/since.mjs --root $ROOT
```

It prints the commits since the previous `STATE.json` sha and maps every changed path to the reference file that
must be refreshed (`architecture.md`, `feature-catalog.md`, `conventions.md`, `operations.md`, `business.md`).
Unmapped paths need a judgement call. Read the touched code, not just the commit message.

## 3. Refresh the narrative

For each affected reference file:
- State **what the feature does for the school**, **where the code is** (cite files in backticks), **which plan
  carries it**, and **which surfaces show it**. One row or one paragraph — the inventories carry the detail.
- Record every **rule** a change introduced or exposed (a new guard, a data invariant, a migration lesson) in
  `conventions.md`, and any environment/host/workflow fact in `operations.md`.
- Pricing, plan, marketing-site, brand or sales changes go to `business.md`.
- Add an entry at the top of `changelog.md`: date, stamp, bullets of what shipped with the spec/file it lives in,
  and any mistake-ledger ids logged. Keep the last five entries in the file; older ones may be summarised.
- Never document a promise as a feature: things not built (e.g. WhatsApp) are listed as not built.
- Keep `SKILL.md`'s "product in one screen" honest when a desk is added or removed.

## 4. Verify

```bash
node $ROOT/.claude/skills/sckools-expert/scripts/check.mjs --root $ROOT
```

Every backticked repo path in the narrative must exist. Fix or drop stale citations. Then read the changed
reference file once as a stranger would: is the first line of each section the thing they came for?

## 5. Sync and commit

```bash
rsync -a --delete $ROOT/.claude/skills/sckools-expert/ /Users/darshanjain/Documents/SchoolManager/SchoolManager/.claude/skills/sckools-expert/
rsync -a --delete $ROOT/.claude/skills/sckools-expert-update/ /Users/darshanjain/Documents/SchoolManager/SchoolManager/.claude/skills/sckools-expert-update/
```

Commit the skill directories in the worktree with the feature (`git add .claude/skills/sckools-expert .claude/skills/sckools-expert-update`) so the knowledge travels with the code, and push to the branch you documented. The project checkout copy is what `/sckools-expert` loads in this session.

## When to run it

After a feature lands on staging; after a migration; after a deploy-process, environment or pricing change;
when the behaviour spec skill is updated; and whenever an answer from `/sckools-expert` turned out stale.
