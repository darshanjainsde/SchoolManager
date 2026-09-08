# GitHub workflows (.github/workflows)

_Generated 2026-09-08 from `9be058c` (staging-site-preview → origin/staging). Do not edit by hand — run the sckools-expert-update skill._

| File | Name | Triggers | Branches | Paths |
| --- | --- | --- | --- | --- |
| ci.yml | ci | push, pull_request | main |  |
| db-backup.yml | Nightly database backup | schedule, workflow_dispatch |  |  |
| db-drift.yml | db-drift | schedule, workflow_dispatch |  |  |
| db-migrate.yml | db-migrate | workflow_dispatch, push | staging | 'packages/db/prisma/migrations/**' |
| db-restore-drill.yml | Restore drill | workflow_dispatch, schedule, push | staging | '.github/workflows/db-restore-drill.yml' |
| demo-data.yml | demo-data | workflow_dispatch, push | staging | 'packages/db/prisma/seed-alumni-demo.ts' 'packages/db/prisma/seed-school-demo.ts' |
| library-ci.yml | library-ci | push, pull_request, workflow_dispatch |  | 'apps/library-api/**';'apps/library-api/**' |
| outbox-drain.yml | Drain notification outbox | schedule, workflow_dispatch |  |  |
