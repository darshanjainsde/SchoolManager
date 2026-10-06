# Notification spine — Tier 1a Implementation Plan (deliveries, identity, race-safe decisions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every outbox row fans out into one `NotificationDelivery` per person per channel with its own retry; a WhatsApp tap is acted on by exactly one resolved person (admin or accounts officer for the leave desk); two desks deciding one leave can never both win; and the two Tier 0 residuals (whole-row resend after a failed `sentAt`, drain deadline anchored to drain start) are closed.

**Architecture:** The drain becomes three steps on the platform client — expand claimed outbox rows into delivery rows (`createMany … skipDuplicates`), claim due deliveries with `FOR UPDATE SKIP LOCKED` and send each through its channel's new `attempt()` (which returns a typed outcome instead of a boolean), then mark an outbox row `sentAt` once none of its deliveries is still QUEUED/HELD. The inbound side gets one `InboundIdentityService` built on `PhoneProfilesService` and a pure `isLeaveDesk()` shared with `LeaveDeskGuard`. Approve/reject become a conditional `updateMany where status = 'PENDING'`.

**Tech Stack:** NestJS 10, Prisma 5.22 (PostgreSQL, RLS), Jest + ts-jest (api), ioredis, Meta Graph API v21.0.

**Spec:** `docs/superpowers/specs/2026-10-06-notification-spine-and-whatsapp-desk-design.md` (§2.2, §3.1, §3.3 LEAVE_DESK rows, §4 race rule, §6 Identity/Safety/Delivery cases, §8 Tier 1). Tier 1b (`2026-10-06-spine-tier1b.md`) builds the leave desk on top of this and needs it merged first.

**Deviations from the spec, and why:**
- `WhatsAppTemplateState` (a table fed by Meta's `message_template_status_update` webhook) is Tier 4. Tier 1 needs only "is this NEW name approved yet?", so the channel asks Meta's own template list (`GET /{WABA}/message_templates`) at most every 10 minutes, and only for names in `GATED_TEMPLATES`. No migration, no webhook, no deploy when Meta approves — the next lookup sees it. Every already-approved name is never looked up, so a lookup failure cannot stop a live template.
- `NotificationDelivery` gains `claimedAt` (the spec model has none; the claim needs it exactly as the outbox does) and `nextAttemptAt` is NOT NULL with `DEFAULT now()` (a nullable column would silently drop a row from the `nextAttemptAt <= now()` claim).
- BELL is not a delivery channel in Tier 1: the bell row is still written in the caller's transaction (it already is, and it is the one channel that cannot fail). Channels in Tier 1: `EMAIL | PUSH | WHATSAPP`.
- The provider ledgers' `deliveryId` back-pointer is Tier 4 (ledger work); the delivery row keeps `providerId` (the WhatsApp message id / Resend id) which joins the same way.
- "Five attempts, then FAILED" with five listed waits (1 m, 5 m, 30 m, 2 h, 12 h): each of the first five failures schedules the next wait, the sixth failure is FAILED — so every listed wait is used.
- Retries are picked up by whatever drain runs next: a write's `requestOutboxDrain()`, the 10-minute `outbox-drain.yml` workflow, or the 02:00 cron. The waits are a floor, not a promise of the minute.
- `InboundIdentityService.actorFor` implements the two needs Tier 1 uses (`LEAVE_DESK`, `SUBSTITUTE`). `FAMILY`/`ACCOUNTS`/`LIBRARIAN`/`SPORTS` arrive with the tiers that use them.
- `INACTIVE` is returned when no live profile matches but the number belongs to a switched-off login of that school.
- Self-decision is refused (§6 "self-approval refused") on the console and WhatsApp alike, not only on WhatsApp — one rule.

## Global Constraints

- Migrations are written, never applied, by a task. Staging applies them on push (`db-migrate.yml`); production is the owner's manual workflow, run before the staging → main merge. Between deploy and migrate the drain's claim fails and rows simply wait — nothing is lost.
- New tenant tables get the house RLS block (`tenant_iso`, `app_current_tenant()`, ENABLE + FORCE) — `packages/db/src/rls-coverage.spec.ts` fails without it.
- Every query on the platform (BYPASSRLS) client carries an explicit `schoolId` in its `where`.
- Only Meta-APPROVED template names are sent. A gated name (`sckools_cover_assigned_v2`, `sckools_cover_cancelled`) goes only after Meta's list says APPROVED; until then its v1 fallback goes, or nothing goes on WhatsApp (email and push still do).
- Retry is per channel: backoff 1 m → 5 m → 30 m → 2 h → 12 h, then FAILED. Transient = network, HTTP 5xx, Meta `130429`, SMTP 4xx. Permanent = Meta `131026/131031/132001/132005/132007` (any other Meta 4xx), SMTP 5xx, a suppressed address.
- An outbox row is `sentAt` when all its deliveries are terminal (SENT/DELIVERED/READ/FAILED/SUPPRESSED/SKIPPED). `NotificationOutbox.attempts` now counts failed expansion passes.
- Email is never held. Quiet hours and the daily fold are Tier 2.
- Every file that writes `notificationOutbox.create*` calls `requestOutboxDrain()` after its transaction (`outbox-writers.guard.spec.ts`).
- Copy is plain English an Indian school office reads at a glance; WhatsApp replies name the school, never the row.
- Work on a branch from `origin/staging` (Tier 0 lives there). `pnpm preflight` green before push; stage explicit paths, never `git add -A`; PR to `staging`.

## Review Focus

1. **A class-wide notice where Meta rate-limits (130429) some parents** — each of those parents' WhatsApp is one delivery retried alone on the backoff; nobody's push or email goes twice. Pinned in Task 4 ("a transient failure is one row retried…").
2. **The drain dies after sending to half a class (deploy, 60 s kill, a failed status write)** — only the deliveries whose result was not recorded can repeat after the 5-minute claim TTL; the outbox row is never re-expanded and the class is never re-sent. Pinned in Task 4 ("a failed status write…" and "a failed close…").
3. **Deploy day: Meta has not approved `cover_assigned_v2`, or `WHATSAPP_WABA_ID` is unset** — the approved v1 card still reaches the substitute. Pinned in Task 1 (channel gate spec).
4. **One phone shared by two people of the school (a husband who is admin, a wife who is the accounts officer)** — a tap acts as neither and says so. Pinned in Task 7 (AMBIGUOUS) and Task 8 (reply).
5. **An accounts officer taps Approve on her own leave request, or two desks tap Approve seconds apart** — refused / one wins, the loser is told who decided and when. Pinned in Task 9.

---

### Task 1: The two Tier 1 templates, submitted first, and the gate that holds them back until Meta approves

**Files:**
- Modify: `apps/api/src/common/notifications/whatsapp/templates.ts`
- Create: `apps/api/src/common/notifications/whatsapp/template-approval.ts`
- Create: `apps/api/src/common/notifications/whatsapp/template-approval.spec.ts`
- Modify: `apps/api/src/common/notifications/whatsapp/whatsapp.spec.ts` (append a describe)
- Modify: `apps/api/src/common/notifications/whatsapp.channel.ts` (constructor, `send`)
- Create: `apps/api/src/common/notifications/whatsapp.channel.gate.spec.ts`
- Modify: `scripts/whatsapp-templates.mjs` (read the registry through `templateSubmissions()`)

**Interfaces:**
- Produces: `COVER_ASSIGNED_V2 = 'sckools_cover_assigned_v2'`, `COVER_CANCELLED = 'sckools_cover_cancelled'`, `GATED_TEMPLATES: ReadonlySet<string>`, `WhatsAppTemplate.fallback?: WhatsAppTemplate`, `templateSubmissions(): TemplateSubmission[]`, `class TemplateApproval { isApproved(name: string): Promise<boolean> }`, `chooseTemplate(t: WhatsAppTemplate, approval: Pick<TemplateApproval,'isApproved'>): Promise<WhatsAppTemplate | null>`, `WhatsAppChannel` 5th constructor arg `approval: Pick<TemplateApproval,'isApproved'>`.
- Consumed by Tier 1b: `COVER_ASSIGNED_V2` (Task 8 there), `COVER_CANCELLED` (Task 6 there).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/common/notifications/whatsapp/whatsapp.spec.ts` (and add `COVER_ASSIGNED_V2, templateSubmissions` to its `./templates` import):

```ts
describe('templateSubmissions — exactly what the submit script hands Meta', () => {
  it('one entry per template name, each with as many samples as placeholders', () => {
    const all = templateSubmissions();
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
    for (const t of all) expect(t.samples).toHaveLength(placeholderCount(t.body));
  });

  it('carries the two Tier 1 templates, so they reach review before the code needs them', () => {
    const byName = new Map(templateSubmissions().map((t) => [t.name, t]));
    expect(byName.get('sckools_cover_assigned_v2')?.buttons).toEqual(['Got it', "Can't"]);
    expect(byName.get('sckools_cover_cancelled')?.category).toBe('UTILITY');
    // The narrow notice templates were invisible to the old regex parser.
    expect(byName.has('sckools_holiday_notice')).toBe(true);
  });

  it('no Utility body starts or ends with a placeholder — Meta refuses both', () => {
    for (const t of templateSubmissions().filter((x) => x.category === 'UTILITY')) {
      expect(t.body).not.toMatch(/^\{\{\d+\}\}/);
      expect(t.body).not.toMatch(/\{\{\d+\}\}[.!?"]?$/);
    }
  });

  it('v2 of the cover card takes the same parameters as v1, so v1 is a true fallback', () => {
    const byName = new Map(templateSubmissions().map((t) => [t.name, t]));
    expect(placeholderCount(byName.get(COVER_ASSIGNED_V2)!.body)).toBe(placeholderCount(SUBMISSIONS.COVER_ASSIGNED.body));
  });
});
```

Create `apps/api/src/common/notifications/whatsapp/template-approval.spec.ts`:

```ts
import { APPROVAL_RETRY_MS, APPROVAL_TTL_MS, TemplateApproval, chooseTemplate } from './template-approval';
import type { WhatsAppTemplate } from './templates';

const CFG = { token: 't', phoneNumberId: '1357286177463978', wabaId: '1615000000000000', graphVersion: 'v21.0' };
const listing = (rows: { name: string; status: string; language?: string }[]) =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows.map((r) => ({ language: 'en', ...r })) }) });

describe('TemplateApproval — is a NEW template approved yet?', () => {
  it('never looks up a name Meta approved long ago', async () => {
    const f = listing([]);
    expect(await new TemplateApproval(() => CFG, f).isApproved('sckools_absence_notice')).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('a gated name is approved only when Meta lists it APPROVED in English', async () => {
    const f = listing([
      { name: 'sckools_cover_assigned_v2', status: 'PENDING' },
      { name: 'sckools_cover_cancelled', status: 'APPROVED', language: 'en_US' },
    ]);
    const a = new TemplateApproval(() => CFG, f);
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(false);
    expect(await a.isApproved('sckools_cover_cancelled')).toBe(false);
    expect(f.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/1615000000000000/message_templates?fields=name,status,language&limit=200');
    expect(f.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer t' } });
  });

  it('asks Meta at most once per ten minutes, then sees the approval without a deploy', async () => {
    let now = 1_000_000;
    const f = listing([{ name: 'sckools_cover_assigned_v2', status: 'PENDING' }]);
    const a = new TemplateApproval(() => CFG, f, () => now);
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(false);
    now += APPROVAL_TTL_MS - 1;
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    f.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ name: 'sckools_cover_assigned_v2', status: 'APPROVED', language: 'en' }] }) });
    now += 1;
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('with no WABA id nothing gated is approved, and Meta is not asked', async () => {
    const f = listing([{ name: 'sckools_cover_assigned_v2', status: 'APPROVED' }]);
    expect(await new TemplateApproval(() => ({ ...CFG, wabaId: null }), f).isApproved('sckools_cover_assigned_v2')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('a failed lookup keeps the last answer and asks again after a minute, not ten', async () => {
    let now = 1_000_000;
    const f = listing([{ name: 'sckools_cover_assigned_v2', status: 'APPROVED' }]);
    const a = new TemplateApproval(() => CFG, f, () => now);
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(true);
    now += APPROVAL_TTL_MS;
    f.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(true);
    now += APPROVAL_RETRY_MS;
    await a.isApproved('sckools_cover_assigned_v2');
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe('chooseTemplate', () => {
  const v1: WhatsAppTemplate = { name: 'sckools_cover_assigned', language: 'en', params: ['a'] };
  const v2: WhatsAppTemplate = { name: 'sckools_cover_assigned_v2', language: 'en', params: ['a'], fallback: v1 };
  it('sends v2 once approved, v1 until then, and nothing for a gated name with no v1', async () => {
    expect(await chooseTemplate(v2, { isApproved: async () => true })).toBe(v2);
    expect(await chooseTemplate(v2, { isApproved: async () => false })).toBe(v1);
    expect(await chooseTemplate({ ...v2, fallback: undefined }, { isApproved: async () => false })).toBeNull();
  });
});
```

Create `apps/api/src/common/notifications/whatsapp.channel.gate.spec.ts`:

```ts
jest.mock('./whatsapp/templates', () => {
  const actual = jest.requireActual('./whatsapp/templates');
  return { ...actual, templateFor: jest.fn(actual.templateFor) };
});

import { WhatsAppChannel } from './whatsapp.channel';
import { templateFor, type WhatsAppTemplate } from './whatsapp/templates';
import type { NotificationMessage } from './notification.types';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CFG = { token: 't', phoneNumberId: '1357286177463978', wabaId: '1615000000000000', graphVersion: 'v21.0' };
const MSG: NotificationMessage = { kind: 'ABSENCE_NOTICE', payload: { schoolName: 'Raffles', studentName: 'Ravi', date: 'Thu 18 Sep' } };
const PARAMS = ['Raffles', 'Mon 13 Oct, period 3', '9-A', 'Maths', 'Priya Nair'];
const V1: WhatsAppTemplate = { name: 'sckools_cover_assigned', language: 'en', params: PARAMS, buttons: [{ type: 'quick_reply', index: 0, payload: 'ack' }] };
const V2: WhatsAppTemplate = {
  name: 'sckools_cover_assigned_v2', language: 'en', params: PARAMS,
  buttons: [{ type: 'quick_reply', index: 0, payload: 'ack' }, { type: 'quick_reply', index: 1, payload: 'cant' }],
  fallback: V1,
};

function db() {
  return {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
    student: { findFirst: jest.fn().mockResolvedValue({ guardianPhone: '98765 43210' }) },
    teacher: { findFirst: jest.fn().mockResolvedValue(null) },
    staff: { findFirst: jest.fn().mockResolvedValue(null) },
    whatsAppSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true, phoneNumberId: null }) },
    whatsAppDelivery: { create: jest.fn().mockResolvedValue({}) },
  };
}
const okFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
const buttonsOf = (f: jest.Mock) => JSON.parse(f.mock.calls[0][1].body).template.components.filter((c: { type: string }) => c.type === 'button');

describe('WhatsAppChannel — a template Meta has not approved yet', () => {
  beforeEach(() => (templateFor as jest.Mock).mockClear());

  it('sends the approved v1 while v2 waits for review', async () => {
    (templateFor as jest.Mock).mockReturnValueOnce(V2);
    const f = okFetch();
    const ch = new WhatsAppChannel(db() as never, () => CFG, f, () => null, { isApproved: async () => false });
    expect(await ch.send('t@x', MSG, SCHOOL)).toBe(true);
    expect(JSON.parse(f.mock.calls[0][1].body).template.name).toBe('sckools_cover_assigned');
    expect(buttonsOf(f)).toHaveLength(1);
  });

  it('sends v2 the moment Meta approves it', async () => {
    (templateFor as jest.Mock).mockReturnValueOnce(V2);
    const f = okFetch();
    const ch = new WhatsAppChannel(db() as never, () => CFG, f, () => null, { isApproved: async () => true });
    await ch.send('t@x', MSG, SCHOOL);
    expect(JSON.parse(f.mock.calls[0][1].body).template.name).toBe('sckools_cover_assigned_v2');
    expect(buttonsOf(f)).toHaveLength(2);
  });

  it('a gated template with no v1 sends nothing and records nothing', async () => {
    (templateFor as jest.Mock).mockReturnValueOnce({ ...V2, fallback: undefined });
    const d = db();
    const f = okFetch();
    const ch = new WhatsAppChannel(d as never, () => CFG, f, () => null, { isApproved: async () => false });
    expect(await ch.send('t@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(d.whatsAppDelivery.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications/whatsapp src/common/notifications/whatsapp.channel.gate.spec.ts`
Expected: FAIL — `Cannot find module './template-approval'`; `templateSubmissions is not a function`; the gate spec fails on the 5th constructor argument being ignored (v2 sent, two buttons).

- [ ] **Step 3: Implement the registry entries**

In `templates.ts`:

1. Add `fallback` to the template type (after `buttons?`):

```ts
  /**
   * The approved template to send instead while THIS one waits for Meta's
   * review (see template-approval.ts). Same parameters, fewer buttons.
   */
  fallback?: WhatsAppTemplate;
```

2. After `export const COVER_PENDING = …` add:

```ts
/**
 * Tier 1 (2026-10-06). A button cannot be added to an approved template in
 * place, so "Got it · Can't" is a new name. Submitted at the start of the
 * tier; the code sends it only once Meta's list says APPROVED.
 */
export const COVER_ASSIGNED_V2 = `${TEMPLATE_PREFIX}cover_assigned_v2`;
/** A cover (or a whole leave) called off — to the substitute and to the desk. */
export const COVER_CANCELLED = `${TEMPLATE_PREFIX}cover_cancelled`;

/**
 * Names that are sent only after Meta's live list says APPROVED. Everything
 * else in this file was approved before the code that sends it shipped.
 * Remove a name once it is approved on production.
 */
export const GATED_TEMPLATES: ReadonlySet<string> = new Set([COVER_ASSIGNED_V2, COVER_CANCELLED]);
```

3. In `EXTRA_SUBMISSIONS`, after the `[COVER_PENDING]` entry, add:

```ts
  [COVER_ASSIGNED_V2]: {
    category: 'UTILITY',
    body: "A cover duty at {{1}}. On {{2}} you are covering class {{3}} for {{4}}, in place of {{5}}. Tap Got it if you will take it, or Can't so the office can find someone else.",
    samples: ['Raffles Public School', 'Mon 22 Sep, period 3 (10:15–11:00)', '9-A', 'Mathematics', 'Priya Nair'],
    buttons: ['Got it', "Can't"],
  },
  [COVER_CANCELLED]: {
    category: 'UTILITY',
    body: 'A change at {{1}}: {{2}} on {{3}} is called off, because {{4}}. Open the Sckools app to see the day as it now stands.',
    samples: ['Raffles Public School', 'your cover of 9-A, period 3', 'Mon 22 Sep 2026', 'the leave it was for was cancelled'],
  },
```

4. At the end of the file add:

```ts
export interface TemplateSubmission {
  name: string;
  category: 'AUTHENTICATION' | 'UTILITY';
  body: string;
  samples: string[];
  buttons: string[];
}

/**
 * Every template, by the NAME the code sends — what `scripts/whatsapp-templates.mjs`
 * submits. Built from TEMPLATE_NAMES rather than from the kind's spelling, so a
 * kind that rides another kind's template (a v2, a shared "called off" card)
 * submits that template once. Two different bodies under one name is a bug and
 * throws.
 */
export function templateSubmissions(): TemplateSubmission[] {
  const out = new Map<string, TemplateSubmission>();
  const put = (s: TemplateSubmission) => {
    const had = out.get(s.name);
    if (had && had.body !== s.body) throw new Error(`Two different bodies are registered for ${s.name}`);
    if (!had) out.set(s.name, s);
  };
  for (const kind of Object.keys(SUBMISSIONS) as NotificationKind[]) {
    const s = SUBMISSIONS[kind];
    put({ name: TEMPLATE_NAMES[kind], category: 'UTILITY', body: s.body, samples: s.samples, buttons: s.buttons ?? [] });
  }
  for (const [name, s] of Object.entries(EXTRA_SUBMISSIONS)) {
    put({ name, category: s.category, body: s.body, samples: s.samples, buttons: s.buttons ?? [] });
  }
  return [...out.values()];
}
```

- [ ] **Step 4: Implement the approval lookup**

Create `apps/api/src/common/notifications/whatsapp/template-approval.ts`:

```ts
import { Logger } from '@nestjs/common';
import { whatsAppConfig, type WhatsAppConfig } from './graph.client';
import { GATED_TEMPLATES, TEMPLATE_LANGUAGE, type WhatsAppTemplate } from './templates';

/**
 * IS THIS NEW TEMPLATE APPROVED YET?
 *
 * Meta reviews a template in hours or days, and a button cannot be added to
 * an approved template in place — a template that gains one is a new name
 * (`_v2`). The code that sends it ships before the review ends, so the
 * channel asks Meta's own list whether the new name is APPROVED; until it is,
 * the approved v1 goes instead, or (for a name with no v1) WhatsApp is
 * skipped and email + push still go. No deploy when Meta approves: the next
 * lookup, at most ten minutes later, sees it.
 *
 * Only names in GATED_TEMPLATES are asked about. Every other name was
 * approved before its code shipped, and a failed lookup must never stop one.
 *
 * Tier 4 replaces the lookup with `WhatsAppTemplateState`, written by Meta's
 * `message_template_status_update` webhook. The question stays the same.
 */
export const APPROVAL_TTL_MS = 10 * 60_000;
/** After a failed lookup: ask again sooner, keep the last answer meanwhile. */
export const APPROVAL_RETRY_MS = 60_000;

interface Known {
  at: number;
  ttl: number;
  approved: Set<string>;
}

export class TemplateApproval {
  private readonly logger = new Logger(TemplateApproval.name);
  private known: Known | null = null;
  private inflight: Promise<Set<string>> | null = null;

  constructor(
    private readonly config: () => WhatsAppConfig | null = () => whatsAppConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async isApproved(name: string): Promise<boolean> {
    if (!GATED_TEMPLATES.has(name)) return true;
    return (await this.approvedNames()).has(name);
  }

  private approvedNames(): Promise<Set<string>> {
    const k = this.known;
    if (k && this.now() - k.at < k.ttl) return Promise.resolve(k.approved);
    this.inflight ??= this.lookup().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async lookup(): Promise<Set<string>> {
    const previous = this.known?.approved ?? new Set<string>();
    const cfg = this.config();
    if (!cfg?.wabaId) {
      // Without the business account id there is no list to read: nothing new
      // is sent until WHATSAPP_WABA_ID is set, and v1 keeps going.
      this.known = { at: this.now(), ttl: APPROVAL_TTL_MS, approved: previous };
      return previous;
    }
    try {
      const res = await this.fetchImpl(
        `https://graph.facebook.com/${cfg.graphVersion}/${cfg.wabaId}/message_templates?fields=name,status,language&limit=200`,
        { headers: { Authorization: `Bearer ${cfg.token}` } },
      );
      if (!res.ok) throw new Error(`Graph API ${res.status}`);
      const body = (await res.json()) as { data?: { name?: string; status?: string; language?: string }[] };
      const approved = new Set(
        (body.data ?? [])
          .filter((t) => t.status === 'APPROVED' && t.language === TEMPLATE_LANGUAGE && !!t.name)
          .map((t) => t.name as string),
      );
      this.known = { at: this.now(), ttl: APPROVAL_TTL_MS, approved };
      return approved;
    } catch (e) {
      this.logger.warn(`Template approval lookup failed; keeping what was known: ${(e as Error).message}`);
      this.known = { at: this.now(), ttl: APPROVAL_RETRY_MS, approved: previous };
      return previous;
    }
  }
}

/** The template to send: this one once approved, else its v1, else nothing. */
export async function chooseTemplate(t: WhatsAppTemplate, approval: Pick<TemplateApproval, 'isApproved'>): Promise<WhatsAppTemplate | null> {
  if (await approval.isApproved(t.name)) return t;
  return t.fallback ?? null;
}
```

- [ ] **Step 5: Wire the gate into the channel**

In `whatsapp.channel.ts`: import `{ TemplateApproval, chooseTemplate } from './whatsapp/template-approval'`; add the constructor parameter after `redis`:

```ts
    private readonly approval: Pick<TemplateApproval, 'isApproved'> = new TemplateApproval(config, fetchImpl),
```

and in `send()` replace `const template = templateFor(message, { child: address.child });` with:

```ts
    // A new template waiting for Meta's review goes as its approved v1, or not at all.
    const template = await chooseTemplate(templateFor(message, { child: address.child }), this.approval);
    if (!template) return false;
```

- [ ] **Step 6: The submit script reads the registry, not a regex**

Replace `scripts/whatsapp-templates.mjs` from the line `// The source of truth.` down to and including `const ALL = [...main, ...extra];` with:

```js
// The source of truth, imported — not parsed. Run through tsx so the TS
// registry is read as code: every template, by the NAME the code sends,
// including the narrow notice templates the old regex never saw.
import { templateSubmissions } from '../apps/api/src/common/notifications/whatsapp/templates.ts';
const ALL = templateSubmissions();
```

Delete the now-unused lines `import { fileURLToPath } from 'node:url';` and `const here = dirname(fileURLToPath(import.meta.url));`, change `import { join, dirname } from 'node:path';` to `import { join } from 'node:path';`, and change the usage block at the top of the file to:

```js
 *   WHATSAPP_WABA_ID=… pnpm --filter @skoolos/api exec tsx ../../scripts/whatsapp-templates.mjs --dry
 *   WHATSAPP_WABA_ID=… pnpm --filter @skoolos/api exec tsx ../../scripts/whatsapp-templates.mjs
```

Dry-run it (no network write; it still reads the live list, so it needs the token file and the WABA id):
Run: `WHATSAPP_WABA_ID=$WHATSAPP_WABA_ID pnpm --filter @skoolos/api exec tsx ../../scripts/whatsapp-templates.mjs --dry`
Expected: the two new names listed with `+`, every approved name with `· … already APPROVED`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications`
Expected: PASS.

- [ ] **Step 8: Submit the two templates (owner-visible step)**

Run the script without `--dry`. Expected: `✓ sckools_cover_assigned_v2 PENDING` and `✓ sckools_cover_cancelled PENDING`. Paste the output into the PR description; review runs while the rest of the tier is built.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/common/notifications/whatsapp/templates.ts apps/api/src/common/notifications/whatsapp/template-approval.ts apps/api/src/common/notifications/whatsapp/template-approval.spec.ts apps/api/src/common/notifications/whatsapp/whatsapp.spec.ts apps/api/src/common/notifications/whatsapp.channel.ts apps/api/src/common/notifications/whatsapp.channel.gate.spec.ts scripts/whatsapp-templates.mjs
git commit -m "feat(whatsapp): cover_assigned_v2 and cover_cancelled submitted; a new template goes as its approved v1 until Meta approves it"
```

---

### Task 2: `NotificationDelivery` and `NotificationOutbox.expandedAt`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `NotificationOutbox`, model `School`, new model)
- Create: `packages/db/prisma/migrations/20261007_000000_notification_delivery/migration.sql`
- Test: `packages/db/src/rls-coverage.spec.ts` (existing — fails if the new table has no policy)

**Interfaces:**
- Produces: Prisma delegate `notificationDelivery` with fields `id, schoolId, outboxId, userId, channel, status, reason, attempts, nextAttemptAt, claimedAt, error, providerId, createdAt, sentAt, deliveredAt, readAt`; `NotificationOutbox.expandedAt: Date | null`.

- [ ] **Step 1: Add the model**

In `schema.prisma`, inside `model NotificationOutbox` add after `lastError String?`:

```prisma
  /// Stamped when the drain has turned this row into NotificationDelivery
  /// rows (one per person per channel). Null = not yet expanded.
  expandedAt     DateTime?
  deliveries     NotificationDelivery[]
```

Inside `model School` add after `notificationOutbox     NotificationOutbox[]`:

```prisma
  notificationDeliveries NotificationDelivery[]
```

After `model NotificationOutbox { … }` add:

```prisma
/// What happened to one outbox row, for one person, on one channel.
/// The truth about a message on a channel; provider ledgers keep receipts.
model NotificationDelivery {
  id            String             @id @default(uuid()) @db.Uuid
  schoolId      String             @db.Uuid
  outboxId      String             @db.Uuid
  userId        String             @db.Uuid
  /// EMAIL | PUSH | WHATSAPP
  channel       String
  /// QUEUED | HELD | SENT | DELIVERED | READ | FAILED | SUPPRESSED | SKIPPED
  status        String             @default("QUEUED")
  /// Why HELD / SUPPRESSED / SKIPPED: no-address | channel-off | duplicate | template-pending | …
  reason        String?
  attempts      Int                @default(0)
  /// When this row is next due. QUEUED rows are due at once; a failure moves it out.
  nextAttemptAt DateTime           @default(now())
  /// The drain that took it. A claim older than 5 minutes is abandoned.
  claimedAt     DateTime?
  error         String?
  /// waMessageId / Resend id / expo ticket.
  providerId    String?
  createdAt     DateTime           @default(now())
  sentAt        DateTime?
  deliveredAt   DateTime?
  readAt        DateTime?
  school        School             @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  outbox        NotificationOutbox @relation(fields: [outboxId], references: [id], onDelete: Cascade)

  @@unique([outboxId, userId, channel])
  @@index([schoolId, createdAt])
  @@index([status, nextAttemptAt])
  @@index([userId, createdAt])
}
```

- [ ] **Step 2: Write the migration**

Create `packages/db/prisma/migrations/20261007_000000_notification_delivery/migration.sql`:

```sql
-- Notification spine, Tier 1: one delivery row per (outbox row, person, channel).
--
-- The outbox row stays the unit a writer creates; the drain expands it into
-- these rows and each one retries on its own. A WhatsApp rate limit for one
-- parent can no longer resend a whole class's push and email.
ALTER TABLE "NotificationOutbox" ADD COLUMN "expandedAt" TIMESTAMP(3);

CREATE TABLE "NotificationDelivery" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "outboxId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "reason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "error" TEXT,
  "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDelivery_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationDelivery_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The unique index leads with outboxId, so it also serves the FK check and
-- the drain's "does this row still have work" probe.
CREATE UNIQUE INDEX "NotificationDelivery_outboxId_userId_channel_key" ON "NotificationDelivery"("outboxId", "userId", "channel");
CREATE INDEX "NotificationDelivery_schoolId_createdAt_idx" ON "NotificationDelivery"("schoolId", "createdAt");
-- The drain's own claim: due rows, soonest first.
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_userId_createdAt_idx" ON "NotificationDelivery"("userId", "createdAt");

-- Tenant isolation, the house pattern. The drain reads through the platform
-- client (BYPASSRLS) with an explicit schoolId; a tenant session sees only its own.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['NotificationDelivery'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY tenant_iso ON %I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant());', t);
  END LOOP;
END $$;
```

- [ ] **Step 3: Validate, generate, run the RLS guard**

Run: `pnpm --filter @skoolos/db exec prisma validate && pnpm --filter @skoolos/db generate && pnpm --filter @skoolos/db exec jest src/rls-coverage.spec.ts`
Expected: `The schema … is valid`, client generated, rls-coverage PASS. (Delete the DO block temporarily and re-run once to watch the guard go red on `NotificationDelivery`, then restore it.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261007_000000_notification_delivery/migration.sql
git commit -m "feat(db): NotificationDelivery — one row per message, person and channel, under RLS"
```

---

### Task 3: Every channel says what happened, not just true/false

**Files:**
- Modify: `apps/api/src/common/notifications/notification.types.ts` (outcome types)
- Modify: `apps/api/src/common/notifications/whatsapp/failure.ts` (+ `isTransientWhatsAppFailure`)
- Create: `apps/api/src/common/mail/mail-outcome.ts`
- Create: `apps/api/src/common/mail/mail-outcome.spec.ts`
- Modify: `apps/api/src/common/mail/mail.service.ts` (`sendLetter` + the ten notification composers take `out?`)
- Modify: `apps/api/src/common/notifications/email.channel.ts`
- Modify: `apps/api/src/common/notifications/push.channel.ts`
- Modify: `apps/api/src/common/notifications/whatsapp.channel.ts`
- Test: `apps/api/src/common/notifications/email.channel.spec.ts`, `push.channel.spec.ts`, `whatsapp.channel.spec.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export type SkipReason = 'no-address' | 'channel-off' | 'duplicate' | 'template-pending';
  export type DeliveryOutcome =
    | { status: 'SENT'; providerId?: string | null }
    | { status: 'SKIPPED'; reason: SkipReason }
    | { status: 'SUPPRESSED'; reason: string }
    | { status: 'RETRY'; error: string }
    | { status: 'FAILED'; error: string };
  export interface DeliveryChannel extends NotificationChannel {
    attempt(to: string, message: NotificationMessage, schoolId: string): Promise<DeliveryOutcome>;
  }
  ```
  `EmailChannel`, `PushChannel`, `WhatsAppChannel` implement `DeliveryChannel`; `send()` stays and maps the outcome to the old boolean. `MailOutcome`, `MailOutcomeSink`, `mailFailure(e: unknown): MailOutcome`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/common/mail/mail-outcome.spec.ts`:

```ts
import { platformBrand } from './letterhead';
import { MailService } from './mail.service';
import { mailFailure, type MailOutcomeSink } from './mail-outcome';
import { ResendApiError } from './resend-transport';

const smtpError = (responseCode: number) => Object.assign(new Error(`SMTP ${responseCode}`), { responseCode });

describe('mailFailure — is it worth trying again?', () => {
  it.each([
    [smtpError(421), 'RETRY'], // mailbox busy, try later
    [smtpError(451), 'RETRY'],
    [smtpError(550), 'FAILED'], // no such mailbox
    [smtpError(554), 'FAILED'],
    [new ResendApiError('validation', 422, 'validation_error'), 'FAILED'],
    [new ResendApiError('slow down', 429, 'rate_limit_exceeded'), 'RETRY'],
    [new ResendApiError('upstream', 503, null), 'RETRY'],
    [new Error('ECONNRESET'), 'RETRY'], // never reached a server
  ])('%s → %s', (e, status) => expect(mailFailure(e).status).toBe(status));
});

describe('MailService.sendLetter reports its outcome to a sink', () => {
  function mailWith(sendMail: jest.Mock, suppressed: string | null = null) {
    const mail = Object.create(MailService.prototype) as MailService;
    Object.assign(mail, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      identity: { forSchool: async () => ({ brand: platformBrand(), from: { name: 'Sckools', address: 'hello@sckools.com' }, transporter: { sendMail }, provider: 'resend', usingCustomSender: false, schoolId: null }) },
      suppressionFor: async () => suppressed,
      ledger: async () => undefined,
    });
    return mail;
  }
  const letter = { title: 't', intro: 'i' };

  it('SENT, with the provider id', async () => {
    const out: MailOutcomeSink = {};
    await mailWith(jest.fn().mockResolvedValue({ messageId: 're_1' })).sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(out.outcome).toEqual({ status: 'SENT', providerId: 're_1' });
  });

  it('SUPPRESSED, without touching the transport', async () => {
    const send = jest.fn();
    const out: MailOutcomeSink = {};
    await mailWith(send, 'BOUNCE: hard').sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(out.outcome).toEqual({ status: 'SUPPRESSED', reason: 'BOUNCE: hard' });
    expect(send).not.toHaveBeenCalled();
  });

  it('a 4xx from SMTP is a retry; the boolean is still false for old callers', async () => {
    const out: MailOutcomeSink = {};
    const ok = await mailWith(jest.fn().mockRejectedValue(smtpError(421))).sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(ok).toBe(false);
    expect(out.outcome?.status).toBe('RETRY');
  });
});
```

Append to `apps/api/src/common/notifications/email.channel.spec.ts`:

```ts
describe('EmailChannel.attempt', () => {
  function withOutcome(outcome: unknown) {
    const mail = Object.create(MailService.prototype) as MailService;
    (mail as unknown as { sendLetter: MailService['sendLetter'] }).sendLetter = async (_to, _s, _subj, _l, _k, out) => {
      if (out) out.outcome = outcome as never;
      return (outcome as { status: string }).status === 'SENT';
    };
    return new EmailChannel(mail);
  }
  const msg = { kind: 'ABSENCE_NOTICE' as const, payload: { schoolName: 'Raffles', studentName: 'Ravi', date: 'Thu 18 Sep' } };

  it('passes the mail service outcome through', async () => {
    expect(await withOutcome({ status: 'RETRY', error: 'SMTP 421' }).attempt('a@x', msg, 's')).toEqual({ status: 'RETRY', error: 'SMTP 421' });
    expect(await withOutcome({ status: 'SENT', providerId: 're_1' }).attempt('a@x', msg, 's')).toEqual({ status: 'SENT', providerId: 're_1' });
  });

  it('send() is still a boolean for notify()', async () => {
    expect(await withOutcome({ status: 'FAILED', error: 'SMTP 550' }).send('a@x', msg, 's')).toBe(false);
  });
});
```

Append to `apps/api/src/common/notifications/push.channel.spec.ts` (inside the file, after the last `describe`):

```ts
describe('PushChannel.attempt', () => {
  const msg = { kind: 'ABSENCE_NOTICE' as const, payload: ABSENCE_NOTICE };

  it('no device on record is SKIPPED no-address, not a failure to retry', async () => {
    prisma.pushToken.findMany.mockResolvedValue([]);
    expect(await harness().attempt('p@x', msg, SCHOOL_A)).toEqual({ status: 'SKIPPED', reason: 'no-address' });
  });

  it('Expo unreachable for every chunk is a RETRY', async () => {
    prisma.pushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[a]' }]);
    send.mockRejectedValue(new Error('socket hang up'));
    expect((await harness().attempt('p@x', msg, SCHOOL_A)).status).toBe('RETRY');
  });

  it('one ok ticket is SENT', async () => {
    prisma.pushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[a]' }]);
    send.mockResolvedValue([{ status: 'ok' }]);
    expect(await harness().attempt('p@x', msg, SCHOOL_A)).toEqual({ status: 'SENT' });
  });
});
```

Append inside `describe('WhatsAppChannel', …)` of `whatsapp.channel.spec.ts`:

```ts
  describe('attempt — what the delivery row records', () => {
    const graphError = (status: number, code: number) => jest.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { message: 'x', code } }) });

    it('SENT carries Meta\'s message id', async () => {
      expect(await new WhatsAppChannel(db() as never, () => CFG, okFetch(), () => null).attempt('p@x', MSG, SCHOOL)).toEqual({ status: 'SENT', providerId: 'wamid.1' });
    });

    it('a school with WhatsApp off is SKIPPED channel-off', async () => {
      const d = db({ whatsAppSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: false, phoneNumberId: null }) } });
      expect(await new WhatsAppChannel(d as never, () => CFG, okFetch(), () => null).attempt('p@x', MSG, SCHOOL)).toEqual({ status: 'SKIPPED', reason: 'channel-off' });
    });

    it('no usable phone is SKIPPED no-address', async () => {
      const d = db({ student: { findFirst: jest.fn().mockResolvedValue({ guardianPhone: 'office' }) } });
      expect(await new WhatsAppChannel(d as never, () => CFG, okFetch(), () => null).attempt('p@x', MSG, SCHOOL)).toEqual({ status: 'SKIPPED', reason: 'no-address' });
    });

    it('Meta 130429 (rate limited) is a RETRY, and the dedup claim is given back', async () => {
      const store = new Set<string>();
      const redis = { status: 'ready', set: jest.fn(async (k: string) => (store.has(k) ? null : (store.add(k), 'OK'))), del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)) };
      const o = await new WhatsAppChannel(db() as never, () => CFG, graphError(400, 130429), () => redis as never).attempt('p@x', MSG, SCHOOL);
      expect(o.status).toBe('RETRY');
      expect(store.size).toBe(0);
    });

    it('Meta 131026 (not on WhatsApp) is FAILED — retrying cannot help', async () => {
      expect((await new WhatsAppChannel(db() as never, () => CFG, graphError(400, 131026), () => null).attempt('p@x', MSG, SCHOOL)).status).toBe('FAILED');
    });

    it('a 5xx from Meta or a dropped connection is a RETRY', async () => {
      expect((await new WhatsAppChannel(db() as never, () => CFG, graphError(503, 2), () => null).attempt('p@x', MSG, SCHOOL)).status).toBe('RETRY');
      expect((await new WhatsAppChannel(db() as never, () => CFG, jest.fn().mockRejectedValue(new Error('ECONNRESET')), () => null).attempt('p@x', MSG, SCHOOL)).status).toBe('RETRY');
    });

    it('the same words to the same phone within a minute are SKIPPED duplicate; send() still calls that true', async () => {
      const c = new WhatsAppChannel(db() as never, () => CFG, okFetch(), () => null);
      await c.attempt('p@x', MSG, SCHOOL);
      expect(await c.attempt('p@x', MSG, SCHOOL)).toEqual({ status: 'SKIPPED', reason: 'duplicate' });
      expect(await c.send('p@x', MSG, SCHOOL)).toBe(true);
    });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/common/mail/mail-outcome.spec.ts src/common/notifications`
Expected: FAIL — `Cannot find module './mail-outcome'`; `attempt is not a function` on all three channels.

- [ ] **Step 3: Outcome types and the WhatsApp classifier**

Append to `notification.types.ts`:

```ts
/**
 * Why a delivery ended without sending. The spine records it on the
 * NotificationDelivery row so "why did this parent not get it" has an answer.
 */
export type SkipReason = 'no-address' | 'channel-off' | 'duplicate' | 'template-pending';

/**
 * What one attempt on one channel came to. RETRY is for failures worth trying
 * again (network, 5xx, Meta 130429, SMTP 4xx); FAILED is final.
 */
export type DeliveryOutcome =
  | { status: 'SENT'; providerId?: string | null }
  | { status: 'SKIPPED'; reason: SkipReason }
  | { status: 'SUPPRESSED'; reason: string }
  | { status: 'RETRY'; error: string }
  | { status: 'FAILED'; error: string };

/** A channel the outbox drain can deliver through, one person at a time. */
export interface DeliveryChannel extends NotificationChannel {
  attempt(to: string, message: NotificationMessage, schoolId: string): Promise<DeliveryOutcome>;
}
```

Append to `whatsapp/failure.ts`:

```ts
/**
 * Worth trying again? Only when Meta never answered (a dropped connection),
 * answered 5xx, or rate-limited us (130429). Every other refusal — not on
 * WhatsApp (131026), a template problem (132xxx), a bad parameter — is the
 * same answer the next time.
 */
export function isTransientWhatsAppFailure(code: number | null, httpStatus: number | null): boolean {
  if (code === 130429) return true;
  if (httpStatus === null) return true;
  return httpStatus >= 500;
}
```

- [ ] **Step 4: Mail outcome**

Create `apps/api/src/common/mail/mail-outcome.ts`:

```ts
import { ResendApiError } from './resend-transport';

/** What one letter came to — the email half of DeliveryOutcome. */
export type MailOutcome =
  | { status: 'SENT'; providerId: string | null }
  | { status: 'SUPPRESSED'; reason: string }
  | { status: 'RETRY'; error: string }
  | { status: 'FAILED'; error: string };

/**
 * Handed down to `sendLetter` by a caller that needs more than a boolean (the
 * outbox drain). The boolean return stays for every other caller.
 */
export interface MailOutcomeSink {
  outcome?: MailOutcome;
}

/**
 * SMTP replies carry a numeric `responseCode` on nodemailer's error: 4xx is
 * "try later", 5xx is "never". Resend speaks HTTP: a 4xx other than 429 is a
 * request it will refuse again; 429 and 5xx pass. No code at all means the
 * server was never reached — try again.
 */
export function mailFailure(e: unknown): MailOutcome {
  const error = ((e as Error)?.message ?? 'unknown error').slice(0, 500);
  const smtp = (e as { responseCode?: unknown } | null)?.responseCode;
  if (typeof smtp === 'number') return smtp >= 500 ? { status: 'FAILED', error } : { status: 'RETRY', error };
  if (e instanceof ResendApiError) {
    const permanent = e.httpStatus >= 400 && e.httpStatus < 500 && e.httpStatus !== 429;
    return permanent ? { status: 'FAILED', error } : { status: 'RETRY', error };
  }
  return { status: 'RETRY', error };
}
```

In `mail.service.ts`: import `{ mailFailure, type MailOutcomeSink } from './mail-outcome'`; give `sendLetter` a sixth parameter `out?: MailOutcomeSink` and set it on each exit:

```ts
    if (suppressed) {
      if (out) out.outcome = { status: 'SUPPRESSED', reason: suppressed };
      await this.ledger({ schoolId, to: address, kind, provider: 'none', status: 'SUPPRESSED', error: suppressed });
      return false;
    }
```

after the successful `ledger` call: `if (out) out.outcome = { status: 'SENT', providerId: id.provider === 'resend' ? (info?.messageId ?? null) : null };`

first line of the `catch`: `if (out) out.outcome = mailFailure(e);`

Then give each of these ten composers a trailing `out?: MailOutcomeSink` parameter and pass it as the sixth argument of its `sendLetter` call (after the kind string): `sendTestScheduled`, `sendTestReminder`, `sendResultsPublished`, `sendAbsenceNotice`, `sendDiaryRemark`, `sendLowAttendance`, `sendLeaveApplied`, `sendLeaveDecided`, `sendCoverAssigned`, `sendAnnouncement`. Example:

```ts
  async sendAbsenceNotice(to: string, info: AbsenceNoticeInfo, schoolId: string | null = null, out?: MailOutcomeSink): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Absence notice: ${info.studentName}`, {
      title: 'Absence notice',
      tone: 'alert',
      intro: `${info.schoolName} marked ${info.studentName} absent on ${info.date}.`,
      note: 'If this is unexpected, please contact the school office.',
    }, 'ABSENCE_NOTICE', out);
  }
```

- [ ] **Step 5: The three channels**

`email.channel.ts` — implement `DeliveryChannel`; move the switch into a private `compose(to, message, schoolId, out)` that passes `out` as the last argument of every `this.mail.sendX(...)` call; then:

```ts
  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    return (await this.attempt(to, message, schoolId)).status === 'SENT';
  }

  async attempt(to: string, message: NotificationMessage, schoolId: string): Promise<DeliveryOutcome> {
    const out: MailOutcomeSink = {};
    const ok = await this.compose(to, message, schoolId, out);
    const o = out.outcome;
    // A composer stub (tests) or an older path that never fills the sink:
    // trust the boolean, and call a silent false a retry.
    if (!o) return ok ? { status: 'SENT' } : { status: 'RETRY', error: 'mail was not sent' };
    return o.status === 'SENT' ? { status: 'SENT', providerId: o.providerId } : o;
  }
```

`push.channel.ts` — implement `DeliveryChannel`; rename the body of `send` to `attempt` with these changes, and make `send` the boolean wrapper:

```ts
  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    return (await this.attempt(to, message, schoolId)).status === 'SENT';
  }

  async attempt(to: string, message: NotificationMessage, schoolId: string): Promise<DeliveryOutcome> {
    const rows = await this.prisma.pushToken.findMany({ where: { schoolId, email: to }, select: { token: true } });
    if (rows.length === 0) return { status: 'SKIPPED', reason: 'no-address' };
    const { ExpoCtor, expo } = await loadExpo();
    const tokens = rows.map((r) => r.token).filter((t) => ExpoCtor.isExpoPushToken(t));
    if (tokens.length === 0) return { status: 'SKIPPED', reason: 'no-address' };

    const { title, body } = formatNotification(message);
    const messages: ExpoPushMessage[] = tokens.map((token) => ({ to: token, sound: 'default', title, body }));
    const chunks = expo.chunkPushNotifications(messages);

    const dead: string[] = [];
    let delivered = false;
    let unreachable = false;
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await expo.sendPushNotificationsAsync(chunk);
      } catch (e) {
        unreachable = true;
        this.logger.error(`Expo push chunk failed: ${(e as Error).message}`);
        continue;
      }
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'ok') delivered = true;
        else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[i].to as string);
        else this.logger.warn(`Expo push ticket error for ${to}: ${ticket.message}`);
      });
    }
    if (dead.length > 0) await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });

    if (delivered) return { status: 'SENT' };
    if (unreachable) return { status: 'RETRY', error: 'Expo push service unreachable' };
    if (dead.length === tokens.length) return { status: 'SKIPPED', reason: 'no-address' };
    return { status: 'FAILED', error: 'every push ticket was refused' };
  }
```

`whatsapp.channel.ts` — implement `DeliveryChannel`. Replace `send()` with `send()` + `attempt()`, and split `deliver()` so the failure code survives:

```ts
  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    const o = await this.attempt(to, message, schoolId);
    // A duplicate means a sibling login on this phone already has it.
    return o.status === 'SENT' || (o.status === 'SKIPPED' && o.reason === 'duplicate');
  }

  async attempt(to: string, message: NotificationMessage, schoolId: string): Promise<DeliveryOutcome> {
    const cfg = this.config();
    if (!cfg) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        this.logger.warn(`WhatsApp is idle — ${whatsAppConfigProblem() ?? 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set.'}`);
      }
      return { status: 'SKIPPED', reason: 'channel-off' };
    }
    const settings = await this.settingsFor(schoolId);
    if (!settings.enabled) return { status: 'SKIPPED', reason: 'channel-off' };

    const address = await this.addressFor(schoolId, to);
    if (!address) return { status: 'SKIPPED', reason: 'no-address' };
    const { phone } = address;

    // A new template waiting for Meta's review goes as its approved v1, or not at all.
    const template = await chooseTemplate(templateFor(message, { child: address.child }), this.approval);
    if (!template) return { status: 'SKIPPED', reason: 'template-pending' };
    const release = await this.claim(phone, template);
    if (!release) return { status: 'SKIPPED', reason: 'duplicate' };
    const r = await this.sendOnce(cfg, schoolId, phone, message.kind, template, settings.phoneNumberId);
    if (r.ok) return { status: 'SENT', providerId: r.messageId };
    await release();
    return isTransientWhatsAppFailure(r.code, r.httpStatus) ? { status: 'RETRY', error: r.reason } : { status: 'FAILED', error: r.reason };
  }
```

and turn `deliver()` into:

```ts
  async deliver(cfg: WhatsAppConfig, schoolId: string, phone: string, kind: string, template: WhatsAppTemplate, phoneNumberId: string | null): Promise<boolean> {
    return (await this.sendOnce(cfg, schoolId, phone, kind, template, phoneNumberId)).ok;
  }

  /**
   * Send a template and write the ledger row. Only the provider call decides
   * success; the ledger write has its own try — a message Meta accepted is
   * never reported as failed because bookkeeping threw (that would release
   * the sibling dedup claim and send a second copy).
   */
  private async sendOnce(
    cfg: WhatsAppConfig,
    schoolId: string,
    phone: string,
    kind: string,
    template: WhatsAppTemplate,
    phoneNumberId: string | null,
  ): Promise<{ ok: true; messageId: string } | { ok: false; code: number | null; httpStatus: number | null; reason: string }> {
    let messageId: string;
    try {
      ({ messageId } = await sendTemplate(cfg, phone, template, { phoneNumberId, fetchImpl: this.fetchImpl }));
    } catch (e) {
      const api = e instanceof WhatsAppApiError ? e : null;
      const reason = api ? `${api.message} (code ${api.code ?? '?'})` : (e as Error).message;
      this.logger.warn(`WhatsApp send to ${phone} (${kind}) failed: ${reason}`);
      try {
        await this.prisma.whatsAppDelivery.create({ data: { schoolId, phone, kind, templateName: template.name, status: 'FAILED', error: reason.slice(0, 500) } });
      } catch (ledgerErr) {
        this.logger.error(`Could not record WhatsApp failure: ${(ledgerErr as Error).message}`);
      }
      return { ok: false, code: api?.code ?? null, httpStatus: api?.httpStatus ?? null, reason: reason.slice(0, 500) };
    }
    try {
      await this.prisma.whatsAppDelivery.create({ data: { schoolId, phone, kind, templateName: template.name, waMessageId: messageId, status: 'SENT', sentAt: new Date() } });
    } catch (ledgerErr) {
      this.logger.error(`WhatsApp ${kind} to ${phone} was sent (${messageId}) but could not be recorded: ${(ledgerErr as Error).message}`);
    }
    return { ok: true, messageId };
  }
```

Imports to add in `whatsapp.channel.ts`: `type DeliveryChannel, type DeliveryOutcome` from `./notification.types`, `isTransientWhatsAppFailure` from `./whatsapp/failure`; change `export class WhatsAppChannel implements NotificationChannel` to `implements DeliveryChannel`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/common/mail src/common/notifications src/common/otp`
Expected: PASS (the old `send()` tests are unchanged and still green).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/notifications/notification.types.ts apps/api/src/common/notifications/whatsapp/failure.ts apps/api/src/common/mail/mail-outcome.ts apps/api/src/common/mail/mail-outcome.spec.ts apps/api/src/common/mail/mail.service.ts apps/api/src/common/notifications/email.channel.ts apps/api/src/common/notifications/email.channel.spec.ts apps/api/src/common/notifications/push.channel.ts apps/api/src/common/notifications/push.channel.spec.ts apps/api/src/common/notifications/whatsapp.channel.ts apps/api/src/common/notifications/whatsapp.channel.spec.ts
git commit -m "feat(notifications): every channel reports SENT / SKIPPED / SUPPRESSED / RETRY / FAILED, not a bare boolean"
```

---

### Task 4: The drain fans out into deliveries, each retried on its own (closes Tier 0 residual a)

**Files:**
- Modify: `apps/api/src/common/notifications/recipients.ts` (+ `resolveRecipientUsers`)
- Modify: `apps/api/src/common/notifications/recipients.spec.ts`
- Modify: `apps/api/src/modules/management/notification-outbox.service.ts` (everything except `toNotificationMessage` and `OUTBOX_EMAIL`)
- Replace: `apps/api/src/modules/management/notification-outbox.service.spec.ts`

**Interfaces:**
- Consumes: `DeliveryOutcome`, `attempt()` on the three channels (Task 3); `notificationDelivery` delegate and `expandedAt` (Task 2).
- Produces: `resolveRecipientUsers(db: TenantTx, schoolId: string, target: { targetUserId: string | null; classSectionId: string | null }): Promise<string[]>`; `channelsFor(kind, payload): DeliveryChannelName[]`; `DELIVERY_BACKOFF_MS`, `DELIVERY_BATCH_CAP = 300`, `DELIVERY_CONCURRENCY = 5`; `NotificationOutboxDrainResult = { processed, expanded, sent, failed, retried, skipped, closed, purged }`. `drain({ purge?, deadline? })` keeps its signature. `EMAIL_CONCURRENCY` is removed.

- [ ] **Step 1: Write the failing recipients test**

Append to `recipients.spec.ts` (add `resolveRecipientUsers` to the import):

```ts
describe('resolveRecipientUsers — who an outbox row is for, by login id', () => {
  it('a single-reader row is that one login, if it has an email at this school', async () => {
    const db = fakeDb();
    db.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@x.com' }]);
    expect(await resolveRecipientUsers(db as never, SCHOOL, { targetUserId: 'u-1', classSectionId: null })).toEqual(['u-1']);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-1'] }, schoolId: SCHOOL }, select: { id: true, email: true } });
    expect(db.student.findMany).not.toHaveBeenCalled();
  });

  it('a class row is every active linked student login of the section, once each', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }, { userId: 'u-1' }]);
    db.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@x.com' }]);
    expect(await resolveRecipientUsers(db as never, SCHOOL, { targetUserId: null, classSectionId: 'cs-1' })).toEqual(['u-1']);
    expect(db.student.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL, classSectionId: 'cs-1' });
  });

  it('a row with neither is nobody', async () => {
    const db = fakeDb();
    expect(await resolveRecipientUsers(db as never, SCHOOL, { targetUserId: null, classSectionId: null })).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement it**

Append to `recipients.ts`:

```ts
/**
 * The logins an outbox row is for, by id — what a NotificationDelivery row is
 * keyed on. A login with no email is left out: every channel addresses a
 * person by their login email within the school.
 */
export async function resolveRecipientUsers(
  db: TenantTx,
  schoolId: string,
  target: { targetUserId: string | null; classSectionId: string | null },
): Promise<string[]> {
  let ids: string[];
  if (target.targetUserId) {
    ids = [target.targetUserId];
  } else if (target.classSectionId) {
    const students = await db.student.findMany({
      where: activeStudentsWhere(schoolId, { classSectionId: target.classSectionId, userId: { not: null } }),
      select: { userId: true },
    });
    ids = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  } else {
    return [];
  }
  const unique = [...new Set(ids)];
  const byId = await emailsByUserId(db, schoolId, unique);
  return unique.filter((id) => byId.has(id));
}
```

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications/recipients.spec.ts` — Expected: PASS.

- [ ] **Step 3: Write the failing drain spec**

Replace the whole of `apps/api/src/modules/management/notification-outbox.service.spec.ts` with:

```ts
const dbMock = {
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  notificationOutbox: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  notificationDelivery: { createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
};

jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => dbMock }));

// The real signal, with `requestOutboxDrain` wrapped so a test can assert the
// drain did NOT chain another drain onto its own (dying) invocation.
jest.mock('../../common/notifications/outbox-signal', () => {
  const actual = jest.requireActual('../../common/notifications/outbox-signal');
  return { ...actual, requestOutboxDrain: jest.fn((...a: unknown[]) => actual.requestOutboxDrain(...a)) };
});

import { NOTIFICATION_OUTBOX_KINDS } from '@skoolos/types';
import {
  DELIVERY_BACKOFF_MS,
  DELIVERY_CONCURRENCY,
  NotificationOutboxService,
  OUTBOX_EMAIL,
  ROW_START_RESERVE_MS,
} from './notification-outbox.service';
import { FIXTURES } from './notification-outbox.fixtures';
import { OUTBOX_DRAIN_DELAY_MS, requestOutboxDrain, resetOutboxSignal } from '../../common/notifications/outbox-signal';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const CLASS_SECTION = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USERS: Record<string, string> = { 'u-1': 'p1@raffles.test', 'u-2': 'p2@raffles.test', 'u-admin': 'head@raffles.test' };

let outboxClaim: unknown[] = [];
let deliveryClaim: unknown[] = [];
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?');

const outboxRow = (o: Partial<{ id: string; kind: string; payload: unknown; classSectionId: string | null; targetUserId: string | null }> = {}) => ({
  id: 'r1', schoolId: SCHOOL, kind: 'ASSIGNMENT_POSTED', payload: FIXTURES.ASSIGNMENT_POSTED, classSectionId: CLASS_SECTION, targetUserId: null, ...o,
});
const delivery = (id: string, channel: 'EMAIL' | 'PUSH' | 'WHATSAPP', o: Partial<{ attempts: number; userId: string; outboxId: string; schoolId: string }> = {}) => ({
  id, schoolId: SCHOOL, outboxId: 'r1', userId: 'u-1', channel, attempts: 0, ...o,
});
const summary = (o: Partial<{ id: string; kind: string; payload: unknown; schoolId: string }> = {}) => ({
  id: 'r1', schoolId: SCHOOL, kind: 'ASSIGNMENT_POSTED', payload: FIXTURES.ASSIGNMENT_POSTED, ...o,
});

describe('NotificationOutboxService.drain', () => {
  const push = { attempt: jest.fn() };
  const whatsapp = { attempt: jest.fn() };
  const email = { attempt: jest.fn() };
  const svc = new NotificationOutboxService(push as never, whatsapp as never, email as never);

  beforeEach(() => {
    jest.clearAllMocks();
    outboxClaim = [];
    deliveryClaim = [];
    dbMock.$queryRaw.mockImplementation(async (strings: string[]) => (strings.join('?').includes('UPDATE "NotificationDelivery"') ? deliveryClaim : outboxClaim));
    dbMock.$executeRaw.mockResolvedValue(0);
    dbMock.notificationOutbox.update.mockResolvedValue({});
    dbMock.notificationOutbox.updateMany.mockResolvedValue({ count: 0 });
    dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.notificationOutbox.findMany.mockResolvedValue([summary()]);
    dbMock.notificationDelivery.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
    dbMock.notificationDelivery.update.mockResolvedValue({});
    dbMock.notificationDelivery.updateMany.mockResolvedValue({ count: 0 });
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }]);
    dbMock.user.findMany.mockImplementation(async (a: { where: { id: { in: string[] }; schoolId: string } }) =>
      a.where.schoolId === SCHOOL ? a.where.id.in.filter((id) => USERS[id]).map((id) => ({ id, email: USERS[id] })) : [],
    );
    dbMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School' });
    for (const c of [push, whatsapp, email]) c.attempt.mockReset().mockResolvedValue({ status: 'SENT' });
  });

  describe('expansion', () => {
    it('claims only unexpanded rows, and binds the attempt cap, stale cutoff and batch cap', async () => {
      await svc.drain({ purge: false });
      const call = dbMock.$queryRaw.mock.calls.find((c) => sqlOf(c).includes('UPDATE "NotificationOutbox"'))!;
      const sql = sqlOf(call);
      expect(sql).toMatch(/"expandedAt" IS NULL/);
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(call.slice(1)).toEqual([5, expect.any(Date), 200]);
    });

    it('a class row becomes one delivery per person per channel, email included where the writer does not email', async () => {
      outboxClaim = [outboxRow()];
      const r = await svc.drain({ purge: false });
      const { data, skipDuplicates } = dbMock.notificationDelivery.createMany.mock.calls[0][0];
      expect(skipDuplicates).toBe(true);
      expect(data).toHaveLength(6);
      expect(data).toContainEqual({ schoolId: SCHOOL, outboxId: 'r1', userId: 'u-2', channel: 'EMAIL' });
      expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { expandedAt: expect.any(Date), claimedAt: null } });
      expect(r).toMatchObject({ processed: 1, expanded: 6 });
    });

    it('a row whose writer already emails gets no EMAIL delivery', async () => {
      outboxClaim = [outboxRow({ kind: 'EXAM_SCHEDULED', payload: FIXTURES.EXAM_SCHEDULED })];
      await svc.drain({ purge: false });
      const channels = dbMock.notificationDelivery.createMany.mock.calls[0][0].data.map((d: { channel: string }) => d.channel);
      expect(new Set(channels)).toEqual(new Set(['PUSH', 'WHATSAPP']));
    });

    it('an unknown kind fails expansion: attempt counted, claim stamped as the back-off, nothing created', async () => {
      outboxClaim = [outboxRow({ kind: 'SOMETHING_ELSE' })];
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.createMany).not.toHaveBeenCalled();
      expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { attempts: { increment: 1 }, lastError: expect.stringContaining('SOMETHING_ELSE'), claimedAt: expect.any(Date) },
      });
      expect(r.failed).toBe(1);
    });

    it('nobody to tell: no deliveries, and the close step marks the row sent', async () => {
      outboxClaim = [outboxRow()];
      dbMock.student.findMany.mockResolvedValue([]);
      dbMock.$executeRaw.mockResolvedValue(1);
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.createMany).not.toHaveBeenCalled();
      const close = sqlOf(dbMock.$executeRaw.mock.calls[0]);
      expect(close).toMatch(/SET "sentAt" = now\(\)/);
      expect(close).toMatch(/"expandedAt" IS NOT NULL/);
      expect(close).toMatch(/NOT EXISTS[\s\S]*status IN \('QUEUED', 'HELD'\)/);
      expect(r.closed).toBe(1);
    });
  });

  describe('sending', () => {
    it('claims due QUEUED/HELD deliveries, soonest first, skipping ones another drain holds', async () => {
      await svc.drain({ purge: false });
      const sql = sqlOf(dbMock.$queryRaw.mock.calls.find((c) => sqlOf(c).includes('UPDATE "NotificationDelivery"'))!);
      expect(sql).toMatch(/status IN \('QUEUED', 'HELD'\)/);
      expect(sql).toMatch(/"nextAttemptAt" <= now\(\)/);
      expect(sql).toMatch(/ORDER BY "nextAttemptAt" ASC/);
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    });

    it('sends each delivery through its own channel and records SENT with the provider id', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'WHATSAPP'), delivery('d3', 'EMAIL')];
      whatsapp.attempt.mockResolvedValue({ status: 'SENT', providerId: 'wamid.1' });
      const r = await svc.drain({ purge: false });
      expect(push.attempt).toHaveBeenCalledWith('p1@raffles.test', expect.objectContaining({ kind: 'ANNOUNCEMENT' }), SCHOOL);
      expect(dbMock.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'd2' },
        data: { status: 'SENT', sentAt: expect.any(Date), providerId: 'wamid.1', attempts: 1, error: null, claimedAt: null },
      });
      expect(r).toMatchObject({ sent: 3, failed: 0, retried: 0 });
    });

    it('a transient failure (Meta 130429) is one row retried on the backoff — 1 m, 5 m, 30 m, 2 h, 12 h — then FAILED', async () => {
      const t0 = 1_700_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        whatsapp.attempt.mockResolvedValue({ status: 'RETRY', error: 'rate limited (code 130429)' });
        for (let failures = 0; failures < DELIVERY_BACKOFF_MS.length; failures += 1) {
          dbMock.notificationDelivery.update.mockClear();
          deliveryClaim = [delivery('d1', 'WHATSAPP', { attempts: failures })];
          await svc.drain({ purge: false });
          expect(dbMock.notificationDelivery.update).toHaveBeenCalledWith({
            where: { id: 'd1' },
            data: { status: 'QUEUED', attempts: failures + 1, error: 'rate limited (code 130429)', nextAttemptAt: new Date(t0 + DELIVERY_BACKOFF_MS[failures]), claimedAt: null },
          });
        }
        expect(DELIVERY_BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
        dbMock.notificationDelivery.update.mockClear();
        deliveryClaim = [delivery('d1', 'WHATSAPP', { attempts: 5 })];
        await svc.drain({ purge: false });
        expect(dbMock.notificationDelivery.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'FAILED', attempts: 6, error: 'rate limited (code 130429)', claimedAt: null } });
        // Push and email for the same parent were never part of this: one row, not five.
        expect(push.attempt).not.toHaveBeenCalled();
        expect(email.attempt).not.toHaveBeenCalled();
      } finally {
        now.mockRestore();
      }
    });

    it('a permanent failure is FAILED at once', async () => {
      deliveryClaim = [delivery('d1', 'WHATSAPP')];
      whatsapp.attempt.mockResolvedValue({ status: 'FAILED', error: 'not on WhatsApp (code 131026)' });
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'FAILED', attempts: 1, error: 'not on WhatsApp (code 131026)', claimedAt: null } });
      expect(r.failed).toBe(1);
    });

    it('SKIPPED and SUPPRESSED record their reason and end the delivery', async () => {
      deliveryClaim = [delivery('d1', 'WHATSAPP'), delivery('d2', 'EMAIL')];
      whatsapp.attempt.mockResolvedValue({ status: 'SKIPPED', reason: 'channel-off' });
      email.attempt.mockResolvedValue({ status: 'SUPPRESSED', reason: 'BOUNCE: hard' });
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'SKIPPED', reason: 'channel-off', claimedAt: null } });
      expect(dbMock.notificationDelivery.update).toHaveBeenCalledWith({ where: { id: 'd2' }, data: { status: 'SUPPRESSED', reason: 'BOUNCE: hard', claimedAt: null } });
      expect(r.skipped).toBe(2);
    });

    it('a channel that throws is a retry for that delivery, never a crash of the batch', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'PUSH', { userId: 'u-2' })];
      push.attempt.mockRejectedValueOnce(new Error('pooler timeout')).mockResolvedValueOnce({ status: 'SENT' });
      const r = await svc.drain({ purge: false });
      expect(r).toMatchObject({ sent: 1, retried: 1 });
    });

    it('a login with no email any more is SKIPPED no-address', async () => {
      deliveryClaim = [delivery('d1', 'PUSH', { userId: 'u-gone' })];
      await svc.drain({ purge: false });
      expect(push.attempt).not.toHaveBeenCalled();
      expect(dbMock.notificationDelivery.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'SKIPPED', reason: 'no-address', claimedAt: null } });
    });

    it('never sends a delivery whose outbox row belongs to another school', async () => {
      deliveryClaim = [delivery('d1', 'PUSH')];
      dbMock.notificationOutbox.findMany.mockResolvedValue([summary({ schoolId: OTHER_SCHOOL })]);
      await svc.drain({ purge: false });
      expect(push.attempt).not.toHaveBeenCalled();
      expect(dbMock.notificationDelivery.update.mock.calls[0][0].data.status).toBe('FAILED');
    });

    it('looks logins up with the school in the where — the platform client bypasses RLS', async () => {
      deliveryClaim = [delivery('d1', 'PUSH')];
      await svc.drain({ purge: false });
      expect(dbMock.user.findMany.mock.calls.at(-1)[0]).toEqual({ where: { schoolId: SCHOOL, id: { in: ['u-1'] } }, select: { id: true, email: true } });
    });

    it('renders a row once and signs the leave buttons at send time, not on the row', async () => {
      deliveryClaim = [delivery('d1', 'WHATSAPP', { userId: 'u-admin' }), delivery('d2', 'EMAIL', { userId: 'u-admin' })];
      dbMock.notificationOutbox.findMany.mockResolvedValue([summary({ kind: 'LEAVE_APPLIED', payload: FIXTURES.LEAVE_APPLIED })]);
      await svc.drain({ purge: false });
      const message = whatsapp.attempt.mock.calls[0][1];
      expect(message.kind).toBe('LEAVE_APPLIED');
      expect(message.payload.approvePayload).toMatch(/^v2:lv:a:/);
      expect(email.attempt.mock.calls[0][1]).toBe(message);
    });

    it('sends at most DELIVERY_CONCURRENCY at a time', async () => {
      deliveryClaim = Array.from({ length: 12 }, (_, i) => delivery(`d${i}`, 'EMAIL'));
      let inFlight = 0;
      let peak = 0;
      email.attempt.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { status: 'SENT' };
      });
      await svc.drain({ purge: false });
      expect(DELIVERY_CONCURRENCY).toBe(5);
      expect(peak).toBe(5);
      expect(email.attempt).toHaveBeenCalledTimes(12);
    });
  });

  describe('what a crash can and cannot repeat (Tier 0 residual a)', () => {
    it('a failed close (sentAt) write re-sends nothing: the next drain finds no row to expand and no delivery due', async () => {
      outboxClaim = [outboxRow({ classSectionId: null, targetUserId: 'u-1' })];
      deliveryClaim = [delivery('d1', 'PUSH')];
      dbMock.$executeRaw.mockRejectedValueOnce(new Error('pooler timeout'));
      await expect(svc.drain({ purge: false })).resolves.toMatchObject({ sent: 1, closed: 0 });
      expect(push.attempt).toHaveBeenCalledTimes(1);

      // Next drain: the row was stamped expandedAt (never re-expanded) and the
      // delivery is SENT (never re-claimed). The close simply runs again.
      outboxClaim = [];
      deliveryClaim = [];
      await svc.drain({ purge: false });
      expect(push.attempt).toHaveBeenCalledTimes(1);
    });

    it('a failed status write leaves only THAT delivery to the 5-minute claim TTL; the batch carries on', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'PUSH', { userId: 'u-2' })];
      dbMock.notificationDelivery.update.mockRejectedValueOnce(new Error('pooler timeout')).mockResolvedValueOnce({});
      await expect(svc.drain({ purge: false })).resolves.toMatchObject({ sent: 2 });
      expect(push.attempt).toHaveBeenCalledTimes(2);
      expect(dbMock.notificationDelivery.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('the time budget', () => {
    it('a drain whose deadline has passed starts no delivery, releases every claim, and does not chain a drain', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'EMAIL')];
      await svc.drain({ purge: false, deadline: Date.now() - 1 });
      expect(push.attempt).not.toHaveBeenCalled();
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['d1', 'd2'] } }, data: { claimedAt: null } });
      expect(requestOutboxDrain).not.toHaveBeenCalled();
    });

    it('never starts a chunk once fewer than ROW_START_RESERVE_MS remain of the 60 s invocation, whatever deadline is passed', async () => {
      const t0 = 1_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        deliveryClaim = Array.from({ length: DELIVERY_CONCURRENCY + 2 }, (_, i) => delivery(`d${i}`, 'PUSH'));
        push.attempt.mockImplementation(async () => {
          now.mockReturnValue(t0 + 60_000 - ROW_START_RESERVE_MS);
          return { status: 'SENT' };
        });
        await svc.drain({ purge: false, deadline: t0 + 10 * 60_000 });
        expect(push.attempt).toHaveBeenCalledTimes(DELIVERY_CONCURRENCY);
        expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['d5', 'd6'] } }, data: { claimedAt: null } });
      } finally {
        now.mockRestore();
      }
    });
  });

  it('a sports row with no school name is filled once per school, and a failed lookup sends as "Your school" without caching', async () => {
    deliveryClaim = [delivery('d1', 'PUSH', { outboxId: 's1' }), delivery('d2', 'PUSH', { outboxId: 's2' })];
    dbMock.notificationOutbox.findMany.mockResolvedValue([summary({ id: 's1', kind: 'SPORTS_NOTICE', payload: FIXTURES.SPORTS_NOTICE }), summary({ id: 's2', kind: 'SPORTS_NOTICE', payload: FIXTURES.SPORTS_NOTICE })]);
    dbMock.school.findFirst.mockRejectedValueOnce(new Error('pooler timeout')).mockResolvedValueOnce({ name: 'Raffles Public School' });
    await svc.drain({ purge: false });
    const names = push.attempt.mock.calls.map((c) => c[1].payload.schoolName).sort();
    expect(names).toEqual(['Raffles Public School', 'Your school']);
  });

  it('OUTBOX_EMAIL names every kind', () => {
    expect(Object.keys(OUTBOX_EMAIL).sort()).toEqual([...NOTIFICATION_OUTBOX_KINDS].sort());
  });

  describe('retention sweep', () => {
    it('the opportunistic path does not sweep', async () => {
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationOutbox.deleteMany).not.toHaveBeenCalled();
      expect(r.purged).toBe(0);
    });

    it('only ever deletes delivered rows, 30 days old, and reports how many', async () => {
      dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 7 });
      const before = Date.now();
      const r = await svc.drain();
      const where = dbMock.notificationOutbox.deleteMany.mock.calls[0][0].where;
      expect(Object.keys(where)).toEqual(['sentAt']);
      expect((before - where.sentAt.lt.getTime()) / 86_400_000).toBeCloseTo(30, 3);
      expect(r.purged).toBe(7);
    });

    it('a failed sweep does not fail the drain', async () => {
      dbMock.notificationOutbox.deleteMany.mockRejectedValue(new Error('lock timeout'));
      await expect(svc.drain()).resolves.toMatchObject({ purged: 0 });
    });

    it('drainSoon never sweeps — it runs on the hot path of an ordinary request', async () => {
      jest.useFakeTimers();
      try {
        svc.onModuleInit();
        svc.drainSoon();
        await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
        expect(dbMock.$queryRaw).toHaveBeenCalled();
        expect(dbMock.notificationOutbox.deleteMany).not.toHaveBeenCalled();
      } finally {
        resetOutboxSignal();
        jest.useRealTimers();
      }
    });
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/notification-outbox.service.spec.ts`
Expected: FAIL — `DELIVERY_BACKOFF_MS` / `DELIVERY_CONCURRENCY` are undefined imports; the expansion tests see no `createMany` call.

- [ ] **Step 5: Implement the drain**

In `notification-outbox.service.ts` keep `toNotificationMessage` and `OUTBOX_EMAIL` exactly as they are. Make these changes:

1. Imports: replace the `resolveSectionRecipients, resolveUserRecipients` import with `import { resolveRecipientUsers } from '../../common/notifications/recipients';`, change `import { getPlatformPrisma } from '@skoolos/db';` to `import { getPlatformPrisma, type Prisma } from '@skoolos/db';`, and add `DeliveryChannel, DeliveryOutcome` to the `notification.types` type import.

2. Replace the `NotificationOutboxDrainResult` interface with:

```ts
export interface NotificationOutboxDrainResult {
  /** Outbox rows claimed for expansion. */
  processed: number;
  /** Delivery rows created by this drain. */
  expanded: number;
  sent: number;
  /** Deliveries that failed for good, plus outbox rows whose expansion failed. */
  failed: number;
  retried: number;
  skipped: number;
  /** Outbox rows marked sentAt because every delivery reached an end. */
  closed: number;
  /** Delivered rows removed by the retention sweep — see `purgeDelivered()`. */
  purged: number;
}
```

3. Delete `EMAIL_CONCURRENCY` and its docstring. Change the `MAX_ATTEMPTS` docstring's first line to "An outbox row whose EXPANSION has failed this many times is left…". Add after `ROW_START_RESERVE_MS`:

```ts
export type DeliveryChannelName = 'EMAIL' | 'PUSH' | 'WHATSAPP';

/**
 * The wait after the 1st … 5th failure of ONE delivery (spec §2.2). The 6th
 * failure is final. Each wait is a floor: the delivery goes on the next drain
 * after it (a write's drain, the 10-minute workflow, or the 02:00 cron).
 */
export const DELIVERY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;

/** Deliveries claimed per drain. Each is one send, so the batch is bounded by time, not by size. */
export const DELIVERY_BATCH_CAP = 300;

/** Sends in flight at once. SMTP is the slow leg; five keeps a class inside one drain. */
export const DELIVERY_CONCURRENCY = 5;

/** The channels a row fans out to. Email only where the writer does not send its own. */
export function channelsFor(kind: NotificationOutboxKind, payload: unknown): DeliveryChannelName[] {
  const email = OUTBOX_EMAIL[kind] && !(payload as { emailed?: boolean } | null)?.emailed;
  return email ? ['PUSH', 'WHATSAPP', 'EMAIL'] : ['PUSH', 'WHATSAPP'];
}
```

4. Replace the class-level docstring's "DELIVERY GUARANTEE" paragraph with:

```ts
 * DELIVERY GUARANTEE. Still at-least-once, and now per delivery: a send and
 * the write that records it are two steps, so a crash between them repeats
 * THAT ONE delivery after CLAIM_TTL_MS — never the row, never the class. An
 * outbox row is expanded once (expandedAt) and closed (sentAt) when none of
 * its deliveries is still QUEUED or HELD.
```

and add `type Db = ReturnType<typeof getPlatformPrisma>;` plus these two interfaces next to `OutboxRow`:

```ts
/** Exactly the columns the delivery claim returns. */
interface ClaimedDelivery {
  id: string;
  schoolId: string;
  outboxId: string;
  userId: string;
  channel: string;
  attempts: number;
}

interface OutboxSummary {
  id: string;
  schoolId: string;
  kind: string;
  payload: unknown;
}
```

5. Replace `drain()` and everything after it up to (not including) `purgeDelivered` with:

```ts
  async drain(opts: { purge?: boolean; deadline?: number } = {}): Promise<NotificationOutboxDrainResult> {
    const { purge = true } = opts;
    // `deadline` is the epoch-ms time after which this drain must not START a
    // send. Whatever the caller asks for, never start one with fewer than
    // ROW_START_RESERVE_MS left of the invocation's 60 s ceiling.
    const started = Date.now();
    const deadline = Math.min(opts.deadline ?? started + DRAIN_TIME_BUDGET_MS, started + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS);
    const db = getPlatformPrisma();
    const result: NotificationOutboxDrainResult = { processed: 0, expanded: 0, sent: 0, failed: 0, retried: 0, skipped: 0, closed: 0, purged: 0 };

    await this.expand(db, deadline, result);
    await this.sendDue(db, deadline, result);
    result.closed = await this.closeFinished(db);
    result.purged = purge ? await this.purgeDelivered(db) : 0;
    return result;
  }

  /**
   * Step 1: turn unexpanded outbox rows into delivery rows. Cheap — a
   * recipient lookup and one createMany per row — and idempotent: the
   * (outboxId, userId, channel) unique plus skipDuplicates makes a re-run
   * after a crash a no-op.
   */
  private async expand(db: Db, deadline: number, result: NotificationOutboxDrainResult): Promise<void> {
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
    const rows = await db.$queryRaw<OutboxRow[]>`
      UPDATE "NotificationOutbox" SET "claimedAt" = now()
      WHERE id IN (
        SELECT id FROM "NotificationOutbox"
        WHERE "sentAt" IS NULL
          AND "expandedAt" IS NULL
          AND attempts < ${MAX_ATTEMPTS}
          AND ("claimedAt" IS NULL OR "claimedAt" < ${staleBefore})
        ORDER BY "createdAt" ASC
        LIMIT ${DRAIN_BATCH_CAP}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "schoolId", kind, payload, "classSectionId", "targetUserId"
    `;
    result.processed = rows.length;
    if (rows.length === DRAIN_BATCH_CAP) {
      this.logger.warn(`Outbox expansion hit the ${DRAIN_BATCH_CAP}-row cap — the rest wait for the next drain.`);
    }

    for (let i = 0; i < rows.length; i += 1) {
      if (Date.now() >= deadline) {
        const rest = rows.slice(i).map((r) => r.id);
        await db.notificationOutbox.updateMany({ where: { id: { in: rest } }, data: { claimedAt: null } });
        this.logger.warn(`Outbox expansion stopped at its deadline; ${rest.length} rows released for the next run.`);
        return;
      }
      const row = rows[i];
      try {
        assertNotificationOutboxKind(row.kind);
        const users = await resolveRecipientUsers(db, row.schoolId, { targetUserId: row.targetUserId, classSectionId: row.classSectionId });
        const channels = channelsFor(row.kind, row.payload);
        const data = users.flatMap((userId) => channels.map((channel) => ({ schoolId: row.schoolId, outboxId: row.id, userId, channel })));
        if (data.length > 0) {
          const { count } = await db.notificationDelivery.createMany({ data, skipDuplicates: true });
          result.expanded += count;
        }
        await db.notificationOutbox.update({ where: { id: row.id }, data: { expandedAt: new Date(), claimedAt: null } });
      } catch (e) {
        result.failed += 1;
        const errorMessage = (e as Error)?.message ?? 'unknown error';
        this.logger.error(`NotificationOutbox row ${row.id} could not be expanded: ${errorMessage}`);
        try {
          // claimedAt is re-stamped NOW, not cleared: holding the claim makes
          // CLAIM_TTL_MS the back-off between expansion attempts.
          await db.notificationOutbox.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 }, lastError: errorMessage.slice(0, 500), claimedAt: new Date() },
          });
        } catch (updateError) {
          this.logger.error(`Failed to record failure for outbox row ${row.id}: ${(updateError as Error).message}`);
        }
      }
    }
  }

  /** Step 2: claim due deliveries and send each through its own channel. */
  private async sendDue(db: Db, deadline: number, result: NotificationOutboxDrainResult): Promise<void> {
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
    const due = await db.$queryRaw<ClaimedDelivery[]>`
      UPDATE "NotificationDelivery" SET "claimedAt" = now()
      WHERE id IN (
        SELECT id FROM "NotificationDelivery"
        WHERE status IN ('QUEUED', 'HELD')
          AND "nextAttemptAt" <= now()
          AND ("claimedAt" IS NULL OR "claimedAt" < ${staleBefore})
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${DELIVERY_BATCH_CAP}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "schoolId", "outboxId", "userId", channel, attempts
    `;
    if (due.length === 0) return;

    const outboxes = new Map(
      (
        await db.notificationOutbox.findMany({
          where: { id: { in: [...new Set(due.map((d) => d.outboxId))] } },
          select: { id: true, schoolId: true, kind: true, payload: true },
        })
      ).map((o) => [o.id, o as OutboxSummary]),
    );
    const emails = await this.emailsOf(db, due);
    const messageFor = this.messageCache(db);

    for (let i = 0; i < due.length; i += DELIVERY_CONCURRENCY) {
      // The deadline is checked before a chunk starts; a chunk in flight finishes.
      // No chained drain: this invocation is near its ceiling. The next write's
      // drain, the 10-minute workflow or the cron picks the released rows up.
      if (Date.now() >= deadline) {
        const rest = due.slice(i).map((d) => d.id);
        await db.notificationDelivery.updateMany({ where: { id: { in: rest } }, data: { claimedAt: null } });
        this.logger.warn(`Delivery drain stopped at its deadline; ${rest.length} deliveries released for the next run.`);
        return;
      }
      await Promise.all(
        due.slice(i, i + DELIVERY_CONCURRENCY).map(async (d) => {
          const outcome = await this.attemptOne(d, outboxes.get(d.outboxId), emails.get(`${d.schoolId}:${d.userId}`), messageFor);
          await this.record(db, d, outcome, result);
        }),
      );
    }
  }

  private channelFor(name: string): DeliveryChannel | null {
    if (name === 'PUSH') return this.push;
    if (name === 'WHATSAPP') return this.whatsapp;
    if (name === 'EMAIL') return this.email;
    return null;
  }

  private async attemptOne(
    d: ClaimedDelivery,
    outbox: OutboxSummary | undefined,
    email: string | undefined,
    messageFor: (o: OutboxSummary) => Promise<NotificationMessage>,
  ): Promise<DeliveryOutcome> {
    // The outbox row names the school; a delivery may only ever speak for it.
    if (!outbox || outbox.schoolId !== d.schoolId) return { status: 'FAILED', error: 'outbox row not found for this school' };
    if (!email) return { status: 'SKIPPED', reason: 'no-address' };
    const channel = this.channelFor(d.channel);
    if (!channel) return { status: 'FAILED', error: `unknown channel ${d.channel}` };
    try {
      return await channel.attempt(email, await messageFor(outbox), d.schoolId);
    } catch (e) {
      return { status: 'RETRY', error: ((e as Error)?.message ?? 'unknown error').slice(0, 500) };
    }
  }

  /**
   * Writes what happened. A failed write is logged and left: the claim stands,
   * so after CLAIM_TTL_MS this one delivery is tried again — the only repeat a
   * crash can cause.
   */
  private async record(db: Db, d: ClaimedDelivery, o: DeliveryOutcome, result: NotificationOutboxDrainResult): Promise<void> {
    const now = Date.now();
    let data: Prisma.NotificationDeliveryUpdateInput;
    switch (o.status) {
      case 'SENT':
        result.sent += 1;
        data = { status: 'SENT', sentAt: new Date(now), providerId: o.providerId ?? null, attempts: d.attempts + 1, error: null, claimedAt: null };
        break;
      case 'SKIPPED':
      case 'SUPPRESSED':
        result.skipped += 1;
        data = { status: o.status, reason: o.reason, claimedAt: null };
        break;
      case 'FAILED':
        result.failed += 1;
        data = { status: 'FAILED', attempts: d.attempts + 1, error: o.error.slice(0, 500), claimedAt: null };
        break;
      case 'RETRY': {
        const failures = d.attempts + 1;
        if (failures > DELIVERY_BACKOFF_MS.length) {
          result.failed += 1;
          data = { status: 'FAILED', attempts: failures, error: o.error.slice(0, 500), claimedAt: null };
        } else {
          result.retried += 1;
          data = { status: 'QUEUED', attempts: failures, error: o.error.slice(0, 500), nextAttemptAt: new Date(now + DELIVERY_BACKOFF_MS[failures - 1]), claimedAt: null };
        }
        break;
      }
    }
    try {
      await db.notificationDelivery.update({ where: { id: d.id }, data });
    } catch (e) {
      this.logger.error(`Delivery ${d.id} (${d.channel}) ended ${o.status} but could not be recorded: ${(e as Error).message}`);
    }
  }

  /** Login emails for the batch, one query per school, keyed `${schoolId}:${userId}`. */
  private async emailsOf(db: Db, due: ClaimedDelivery[]): Promise<Map<string, string>> {
    const bySchool = new Map<string, Set<string>>();
    for (const d of due) {
      const ids = bySchool.get(d.schoolId) ?? new Set<string>();
      ids.add(d.userId);
      bySchool.set(d.schoolId, ids);
    }
    const out = new Map<string, string>();
    for (const [schoolId, ids] of bySchool) {
      const users = await db.user.findMany({ where: { schoolId, id: { in: [...ids] } }, select: { id: true, email: true } });
      for (const u of users) if (u.email) out.set(`${schoolId}:${u.id}`, u.email);
    }
    return out;
  }

  /**
   * One rendered message per outbox row per drain (the leave buttons are
   * signed here, at send time, never stored). Some writers leave the school's
   * name off the row; it is filled once per school, and a FAILED lookup sends
   * as 'Your school' without caching the miss.
   */
  private messageCache(db: Db): (o: OutboxSummary) => Promise<NotificationMessage> {
    const messages = new Map<string, Promise<NotificationMessage>>();
    const schoolNames = new Map<string, string>();
    const schoolNameOf = async (id: string) => {
      const known = schoolNames.get(id);
      if (known !== undefined) return known;
      try {
        const name = (await db.school.findFirst({ where: { id }, select: { name: true } }))?.name ?? 'Your school';
        schoolNames.set(id, name);
        return name;
      } catch (e) {
        this.logger.warn(`school name lookup for ${id} failed, sending as 'Your school': ${(e as Error)?.message}`);
        return 'Your school';
      }
    };
    return (o) => {
      let p = messages.get(o.id);
      if (!p) {
        p = (async () => {
          assertNotificationOutboxKind(o.kind);
          const message = toNotificationMessage(o.kind, o.payload);
          if (!message.payload.schoolName) message.payload.schoolName = await schoolNameOf(o.schoolId);
          return message;
        })();
        messages.set(o.id, p);
      }
      return p;
    };
  }

  /**
   * Step 3: an outbox row is done when none of its deliveries is still
   * QUEUED or HELD. A failure here is logged and costs nothing — the next
   * drain runs the same statement.
   */
  private async closeFinished(db: Db): Promise<number> {
    try {
      return await db.$executeRaw`
        UPDATE "NotificationOutbox" o SET "sentAt" = now(), "claimedAt" = NULL
        WHERE o."sentAt" IS NULL
          AND o."expandedAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "NotificationDelivery" d
            WHERE d."outboxId" = o.id AND d.status IN ('QUEUED', 'HELD')
          )
      `;
    } catch (e) {
      this.logger.error(`Closing finished outbox rows failed: ${(e as Error)?.message}`);
      return 0;
    }
  }
```

`purgeDelivered()` stays; its `db` parameter type becomes `Db`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/notification-outbox src/common/notifications`
Expected: PASS. `notification-outbox.controller.spec.ts` is unchanged and still green (it mocks `drain`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/notifications/recipients.ts apps/api/src/common/notifications/recipients.spec.ts apps/api/src/modules/management/notification-outbox.service.ts apps/api/src/modules/management/notification-outbox.service.spec.ts
git commit -m "feat(outbox): rows fan out into per-person, per-channel deliveries with their own retry; a crash repeats one delivery, never a class"
```

---

### Task 5: A drain asked for late in a request is bounded by that request's 60 s (closes Tier 0 residual b)

**Files:**
- Create: `apps/api/src/common/notifications/invocation-clock.ts`
- Create: `apps/api/src/common/notifications/invocation-clock.spec.ts`
- Modify: `apps/api/src/common/notifications/outbox-signal.ts`
- Modify: `apps/api/src/common/notifications/outbox-signal.spec.ts`
- Modify: `apps/api/src/modules/management/notification-outbox.service.ts` (constants, `onModuleInit`)
- Modify: `apps/api/src/app.module.ts` (register the interceptor first)
- Modify: `apps/api/server.ts` (stamp the invocation start)
- Modify: `apps/api/src/entrypoint-guards.spec.ts`

**Interfaces:**
- Produces: `runInvocation<T>(fn: () => T, startedAt?: number): T`, `invocationStartedAt(): number | undefined`, `InvocationClockInterceptor`; `INVOCATION_CEILING_MS = 60_000` and `ROW_START_RESERVE_MS = 15_000` now live in `outbox-signal.ts` (re-exported from the service); drainer signature `(opts: { deadline?: number }) => Promise<unknown>`.

- [ ] **Step 1: Write the failing tests**

Append to `outbox-signal.spec.ts` (add `INVOCATION_CEILING_MS, ROW_START_RESERVE_MS` to its import and `import { runInvocation } from './invocation-clock';`):

```ts
describe('the drain knows the invocation it runs in', () => {
  beforeEach(() => { jest.useFakeTimers(); resetOutboxSignal(); });
  afterEach(() => { jest.useRealTimers(); resetOutboxSignal(); });

  it('a drain asked for 30 s into a request must stop starting sends 30 s sooner', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    const requestStarted = Date.now() - 30_000;
    runInvocation(() => requestOutboxDrain(), requestStarted);
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledWith({ deadline: requestStarted + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS });
  });

  it('outside any request (a script) the drain keeps its own budget', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    requestOutboxDrain();
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledWith({ deadline: undefined });
  });

  it('a burst keeps the FIRST caller\'s deadline — the drain runs in that caller\'s invocation', async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerOutboxDrainer(drain);
    const first = Date.now() - 40_000;
    runInvocation(() => requestOutboxDrain(), first);
    runInvocation(() => requestOutboxDrain(), Date.now());
    await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith({ deadline: first + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS });
  });
});
```

Create `apps/api/src/common/notifications/invocation-clock.spec.ts`:

```ts
import { lastValueFrom, of } from 'rxjs';
import { InvocationClockInterceptor, invocationStartedAt, runInvocation } from './invocation-clock';

const httpCtx = (req: unknown) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as never;

describe('invocation clock', () => {
  it('is empty outside a request and set inside one', () => {
    expect(invocationStartedAt()).toBeUndefined();
    expect(runInvocation(() => invocationStartedAt(), 123)).toBe(123);
  });

  it('the interceptor starts the clock at the stamp server.ts put on the request — cold start included', async () => {
    const next = { handle: () => of(invocationStartedAt()) };
    const seen = await lastValueFrom(new InvocationClockInterceptor().intercept(httpCtx({ skInvokedAt: 42 }), next));
    expect(seen).toBe(42);
  });

  it('with no stamp (local dev) it starts the clock when the request reaches Nest', async () => {
    const before = Date.now();
    const next = { handle: () => of(invocationStartedAt()) };
    const seen = (await lastValueFrom(new InvocationClockInterceptor().intercept(httpCtx({}), next))) as number;
    expect(seen).toBeGreaterThanOrEqual(before);
  });
});
```

Append to `apps/api/src/entrypoint-guards.spec.ts`:

```ts
describe('the Vercel entrypoint stamps when the invocation began', () => {
  it('before it waits for a cold start — boot time counts against the 60 s too', () => {
    const src = readFileSync(resolve(apiRoot, 'server.ts'), 'utf8');
    const stamp = src.indexOf('skInvokedAt = Date.now()');
    expect(stamp).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(src.indexOf('await ready'));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications/outbox-signal.spec.ts src/common/notifications/invocation-clock.spec.ts src/entrypoint-guards.spec.ts`
Expected: FAIL — `Cannot find module './invocation-clock'`; drain called with no argument; no stamp in server.ts.

- [ ] **Step 3: Implement the clock**

Create `apps/api/src/common/notifications/invocation-clock.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * WHEN DID THIS INVOCATION BEGIN?
 *
 * A drain asked for by a request runs inside that request's invocation (via
 * waitUntil), and the function is killed 60 s after the INVOCATION began —
 * not after the drain began. A request that spent 30 s on work (a cold start,
 * a big import) and then asked for a drain used to hand it a full 45 s it did
 * not have; the last sends were killed mid-flight. The clock lets the signal
 * pass the real deadline.
 *
 * server.ts stamps `req.skInvokedAt` on entry (before the cold-start await);
 * this interceptor — registered first, so it wraps everything — carries it
 * through AsyncLocalStorage. Nest binds interceptor handlers with
 * AsyncResource, which is what makes the store visible in the service.
 */
const store = new AsyncLocalStorage<number>();

export function runInvocation<T>(fn: () => T, startedAt: number = Date.now()): T {
  return store.run(startedAt, fn);
}

export function invocationStartedAt(): number | undefined {
  return store.getStore();
}

@Injectable()
export class InvocationClockInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    let startedAt = Date.now();
    try {
      const stamped = context.switchToHttp().getRequest<{ skInvokedAt?: unknown }>()?.skInvokedAt;
      if (typeof stamped === 'number') startedAt = stamped;
    } catch {
      /* the clock must never affect a response */
    }
    return runInvocation(() => next.handle(), startedAt);
  }
}
```

- [ ] **Step 4: The signal passes the deadline**

In `outbox-signal.ts`: import `{ invocationStartedAt } from './invocation-clock'`; add

```ts
/** The function's hard ceiling (`maxDuration: 60` in apps/api/vercel.json). */
export const INVOCATION_CEILING_MS = 60_000;

/**
 * No send STARTS with less than this left of the 60 s ceiling. A send killed
 * mid-flight repeats after the claim TTL; not starting it is the safer side.
 */
export const ROW_START_RESERVE_MS = 15_000;
```

change `type Drainer = () => Promise<unknown>;` to `type Drainer = (opts: { deadline?: number }) => Promise<unknown>;`, and in `requestOutboxDrain()` replace `if (!drainer || scheduled) return;` with:

```ts
  if (!drainer || scheduled) return;
  // The drain runs inside THIS caller's invocation, so it inherits this
  // caller's deadline — measured from when the invocation began.
  const started = invocationStartedAt();
  const deadline = started === undefined ? undefined : started + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS;
```

and `return fn();` with `return fn({ deadline });`.

In `notification-outbox.service.ts`: delete the local `INVOCATION_CEILING_MS` and `ROW_START_RESERVE_MS` declarations, import both from `'../../common/notifications/outbox-signal'`, add `export { ROW_START_RESERVE_MS } from '../../common/notifications/outbox-signal';`, and change `onModuleInit` to:

```ts
  onModuleInit(): void {
    registerOutboxDrainer((o) => this.drain({ purge: false, deadline: o.deadline }));
  }
```

In `app.module.ts` import `InvocationClockInterceptor` from `'./common/notifications/invocation-clock'` and put `{ provide: APP_INTERCEPTOR, useClass: InvocationClockInterceptor },` immediately BEFORE the `MetricsInterceptor` line (registration order is nesting order; the clock must be outermost).

In `server.ts`, make the first line of `handler`:

```ts
  // When this invocation began — before the cold-start await, because boot
  // time counts against the 60 s too (see common/notifications/invocation-clock.ts).
  (req as IncomingMessage & { skInvokedAt?: number }).skInvokedAt = Date.now();
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications src/modules/management/notification-outbox src/entrypoint-guards.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/notifications/invocation-clock.ts apps/api/src/common/notifications/invocation-clock.spec.ts apps/api/src/common/notifications/outbox-signal.ts apps/api/src/common/notifications/outbox-signal.spec.ts apps/api/src/modules/management/notification-outbox.service.ts apps/api/src/app.module.ts apps/api/server.ts apps/api/src/entrypoint-guards.spec.ts
git commit -m "fix(outbox): a drain asked for late in a request stops starting sends by THAT invocation's 60 s, not its own"
```

---

### Task 6: One rule for "who runs the leave desk", and the officer hears about every request

**Files:**
- Modify: `apps/api/src/common/notifications/recipients.ts` (+ `leaveDeskStaffWhere`, `resolveLeaveDeskRecipients`)
- Modify: `apps/api/src/common/notifications/recipients.spec.ts`
- Modify: `apps/api/src/modules/management/internal/leave-desk.guard.ts` (+ exported `isLeaveDesk`)
- Modify: `apps/api/src/modules/management/internal/leave-desk.guard.spec.ts`
- Modify: `apps/api/src/modules/management/index.ts` (export `isLeaveDesk`)
- Modify: `apps/api/src/modules/management/leave.service.ts` (`tellAdminsApplied` → `tellDeskApplied`)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts` (notices block)

**Interfaces:**
- Produces: `leaveDeskStaffWhere(schoolId: string): { schoolId: string; role: 'ACCOUNTS'; isActive: true }`; `resolveLeaveDeskRecipients(db: TenantTx, schoolId: string): Promise<{ userId: string; email: string }[]>`; `isLeaveDesk(db: Pick<TenantTx, 'staff'>, schoolId: string, user: { userId: string; role: string }): Promise<boolean>`.
- Consumed by: Task 7 (`isLeaveDesk`), Tier 1b (desk notices, the nudge cron).

- [ ] **Step 1: Write the failing tests**

Append to `recipients.spec.ts` (import `resolveLeaveDeskRecipients`):

```ts
describe('resolveLeaveDeskRecipients — the people LeaveDeskGuard lets in', () => {
  function deskDb() {
    return { user: { findMany: jest.fn() }, staff: { findMany: jest.fn() }, student: { findMany: jest.fn() } };
  }

  it('every active admin plus every active accounts officer with a login, once each', async () => {
    const db = deskDb();
    db.user.findMany
      .mockResolvedValueOnce([{ id: 'u-head', email: 'head@x' }]) // admins
      .mockResolvedValueOnce([{ id: 'u-acc', email: 'accounts@x' }]); // officers' logins
    db.staff.findMany.mockResolvedValue([{ userId: 'u-acc' }, { userId: 'u-head' }]);
    expect(await resolveLeaveDeskRecipients(db as never, SCHOOL)).toEqual([
      { userId: 'u-head', email: 'head@x' },
      { userId: 'u-acc', email: 'accounts@x' },
    ]);
    expect(db.staff.findMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, role: 'ACCOUNTS', isActive: true, userId: { not: null } }, select: { userId: true } });
    // The admin who is also on the accounts roll is not asked about twice.
    expect(db.user.findMany.mock.calls[1][0]).toEqual({ where: { schoolId: SCHOOL, id: { in: ['u-acc'] }, isActive: true }, select: { id: true, email: true } });
  });

  it('no officer: just the admins, and no second query', async () => {
    const db = deskDb();
    db.user.findMany.mockResolvedValueOnce([{ id: 'u-head', email: 'head@x' }]);
    db.staff.findMany.mockResolvedValue([]);
    expect(await resolveLeaveDeskRecipients(db as never, SCHOOL)).toEqual([{ userId: 'u-head', email: 'head@x' }]);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });
});
```

Append to `leave-desk.guard.spec.ts` (import `isLeaveDesk` from `'./leave-desk.guard'`):

```ts
describe('isLeaveDesk — the same rule for the console and for WhatsApp', () => {
  const db = { staff: { findFirst: jest.fn() } };
  beforeEach(() => db.staff.findFirst.mockReset());

  it('an admin is the desk without a lookup', async () => {
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u1', role: 'SCHOOL_ADMIN' })).toBe(true);
    expect(db.staff.findFirst).not.toHaveBeenCalled();
  });

  it('a staff login is the desk only as an active accounts officer of THIS school', async () => {
    db.staff.findFirst.mockResolvedValue({ id: 's1' });
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u2', role: 'STAFF' })).toBe(true);
    expect(db.staff.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, role: 'ACCOUNTS', isActive: true, userId: 'u2' }, select: { id: true } });
  });

  it('a teacher or a family never is', async () => {
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u3', role: 'TEACHER' })).toBe(false);
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u4', role: 'STUDENT' })).toBe(false);
    expect(db.staff.findFirst).not.toHaveBeenCalled();
  });
});
```

In `leave.service.spec.ts`, inside `describe('LeaveService notices', …)` add:

```ts
  it('apply tells the accounts officer too — she runs the desk the guard lets her into', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 't1', firstName: 'Priya', lastName: 'Nair' });
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.leaveApplication.create.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: 't1', type: 'CASUAL', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21'), reason: null, status: 'PENDING', reviewedById: null, reviewedAt: null, createdAt: new Date() });
    txMock.user.findMany.mockResolvedValueOnce([{ id: 'a1', email: 'a1@x' }]).mockResolvedValueOnce([{ id: 'acc', email: 'acc@x' }]);
    txMock.staff.findMany.mockResolvedValueOnce([{ userId: 'acc' }]);
    await svc.apply('S', 'u-teacher', { type: 'CASUAL', startDate: '2026-09-21', endDate: '2026-09-21' } as never);
    expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.targetUserId)).toEqual(['a1', 'acc']);
    expect(txMock.notification.create).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications/recipients.spec.ts src/modules/management/internal/leave-desk.guard.spec.ts src/modules/management/leave.service.spec.ts`
Expected: FAIL — `resolveLeaveDeskRecipients` / `isLeaveDesk` not exported; the officer gets no outbox row.

- [ ] **Step 3: Implement**

Append to `recipients.ts`:

```ts
/** The accounts officers of a school — the staff half of the leave desk. */
export function leaveDeskStaffWhere(schoolId: string) {
  return { schoolId, role: 'ACCOUNTS' as const, isActive: true as const };
}

/**
 * Everyone who runs the leave desk: every active admin, plus every active
 * accounts officer with a login — the same set LeaveDeskGuard admits. Until
 * 2026-10-06 a leave request went to admins only, so the officer who decides
 * most of them heard nothing.
 */
export async function resolveLeaveDeskRecipients(db: TenantTx, schoolId: string): Promise<{ userId: string; email: string }[]> {
  const [admins, officers] = await Promise.all([
    resolveAdminRecipients(db, schoolId),
    db.staff.findMany({ where: { ...leaveDeskStaffWhere(schoolId), userId: { not: null } }, select: { userId: true } }),
  ]);
  const adminIds = new Set(admins.map((a) => a.userId));
  const officerIds = [...new Set(officers.map((o) => o.userId).filter((id): id is string => !!id && !adminIds.has(id)))];
  if (officerIds.length === 0) return admins;
  const users = await db.user.findMany({ where: { schoolId, id: { in: officerIds }, isActive: true }, select: { id: true, email: true } });
  return [...admins, ...users.filter((u) => u.email).map((u) => ({ userId: u.id, email: u.email }))];
}
```

In `leave-desk.guard.ts` add (and import `type TenantTx` from `@skoolos/db`, `leaveDeskStaffWhere` from `'../../../common/notifications/recipients'`):

```ts
/**
 * THE RULE, without the HTTP. The guard calls it with a tenant transaction;
 * the WhatsApp resolver calls it with the platform client — both pass the
 * school explicitly, so the query is scoped either way.
 */
export async function isLeaveDesk(db: Pick<TenantTx, 'staff'>, schoolId: string, user: { userId: string; role: string }): Promise<boolean> {
  if (user.role === 'SCHOOL_ADMIN') return true;
  if (user.role !== 'STAFF') return false;
  const staff = await db.staff.findFirst({ where: { ...leaveDeskStaffWhere(schoolId), userId: user.userId }, select: { id: true } });
  return !!staff;
}
```

and replace the body of `canActivate` after the admin line with:

```ts
    const { schoolId } = this.tenant.requireTenant();
    const ok = await withTenant(schoolId, (tx) => isLeaveDesk(tx, schoolId, { userId: user.sub, role: user.role }));
    if (!ok) {
      throw new ApiError('NOT_LEAVE_DESK', 'Only a school admin or an accounts officer can decide leave.', 403);
    }
    return true;
```

(The existing guard test that matches `objectContaining({ role: 'ACCOUNTS', isActive: true, schoolId })` keeps passing.)

In `management/index.ts` add: `export { isLeaveDesk } from './internal/leave-desk.guard';`

In `leave.service.ts`: import `resolveLeaveDeskRecipients` instead of `resolveAdminRecipients`; rename `tellAdminsApplied` to `tellDeskApplied` (and its call in `apply`); inside it replace `resolveAdminRecipients(tx, schoolId)` with `resolveLeaveDeskRecipients(tx, schoolId)` and rename the local `admins` to `desk` (both uses).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications/recipients.spec.ts src/modules/management`
Expected: PASS (`leave-staff.spec.ts` included — its `staff.findMany` is absent from that file's txMock, so add `findMany: jest.fn().mockResolvedValue([])` to its `staff` mock).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/notifications/recipients.ts apps/api/src/common/notifications/recipients.spec.ts apps/api/src/modules/management/internal/leave-desk.guard.ts apps/api/src/modules/management/internal/leave-desk.guard.spec.ts apps/api/src/modules/management/index.ts apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts apps/api/src/modules/management/leave-staff.spec.ts
git commit -m "feat(leave): one isLeaveDesk() for the console and WhatsApp; the accounts officer is told about every leave request"
```

---

### Task 7: `InboundIdentityService` — who is tapping, decided once

**Files:**
- Create: `apps/api/src/modules/whatsapp/inbound-identity.service.ts`
- Create: `apps/api/src/modules/whatsapp/inbound-identity.service.spec.ts`
- Modify: `apps/api/src/modules/auth/index.ts` (export `PhoneProfilesService`, `PhoneProfile`)
- Modify: `apps/api/src/modules/auth/internal/auth.module.ts` (`exports`)
- Modify: `apps/api/src/modules/whatsapp/whatsapp.module.ts` (import `AuthModule`, provide the service)

**Interfaces:**
- Consumes: `isLeaveDesk` (Task 6); `PhoneProfilesService.resolve(phone, { schoolId })`.
- Produces:
  ```ts
  export type InboundNeed = { kind: 'LEAVE_DESK' } | { kind: 'SUBSTITUTE'; substitutionId: string };
  export type ActorResult = { ok: true; profile: PhoneProfile } | { ok: false; why: 'NO_PROFILE' | 'NOT_ALLOWED' | 'AMBIGUOUS' | 'INACTIVE' };
  class InboundIdentityService { actorFor(phone: string, schoolId: string, need: InboundNeed): Promise<ActorResult> }
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/whatsapp/inbound-identity.service.spec.ts`:

```ts
const db = {
  user: { count: jest.fn() },
  staff: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));

import { InboundIdentityService } from './inbound-identity.service';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PHONE = '+919876543210';
const profile = (userId: string, kind: 'ADMIN' | 'TEACHER' | 'STAFF' | 'FAMILY', role: string) => ({ userId, schoolId: A, schoolName: 'Raffles', host: 'raffles.sckools.com', role, kind, label: userId, sub: kind });

describe('InboundIdentityService.actorFor', () => {
  const profiles = { resolve: jest.fn() };
  const svc = () => new InboundIdentityService(profiles as never);
  beforeEach(() => {
    jest.clearAllMocks();
    db.user.count.mockResolvedValue(0);
    db.staff.findFirst.mockResolvedValue(null);
  });

  it('asks about this school only, with the number normalised — a "+1 (555) …" tap matches the stored E.164', async () => {
    profiles.resolve.mockResolvedValue([]);
    await svc().actorFor('+1 (555) 159-7744', A, { kind: 'LEAVE_DESK' });
    expect(profiles.resolve).toHaveBeenCalledWith('+15551597744', { schoolId: A });
  });

  it('an admin is the leave desk', async () => {
    profiles.resolve.mockResolvedValue([profile('u-head', 'ADMIN', 'SCHOOL_ADMIN')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: true, profile: expect.objectContaining({ userId: 'u-head' }) });
  });

  it('the accounts officer is the leave desk; a driver on the same school is not', async () => {
    profiles.resolve.mockResolvedValue([profile('u-acc', 'STAFF', 'STAFF')]);
    db.staff.findFirst.mockResolvedValueOnce({ id: 's1' });
    expect((await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).ok).toBe(true);
    expect(db.staff.findFirst.mock.calls[0][0].where).toMatchObject({ schoolId: A, userId: 'u-acc', role: 'ACCOUNTS' });
    profiles.resolve.mockResolvedValue([profile('u-driver', 'STAFF', 'STAFF')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
  });

  it('a teacher at A (who is a parent at B) tapping Approve on A\'s leave is NOT_ALLOWED', async () => {
    profiles.resolve.mockResolvedValue([profile('u-t', 'TEACHER', 'TEACHER')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
  });

  it('two admins verified on one phone: AMBIGUOUS — nobody acts for both', async () => {
    profiles.resolve.mockResolvedValue([profile('u-1', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-2', 'ADMIN', 'SCHOOL_ADMIN')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'AMBIGUOUS' });
  });

  it('an unknown number is NO_PROFILE; a number whose only login was switched off is INACTIVE', async () => {
    profiles.resolve.mockResolvedValue([]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NO_PROFILE' });
    db.user.count.mockResolvedValue(1);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'INACTIVE' });
    expect(db.user.count).toHaveBeenCalledWith({ where: { schoolId: A, phone: PHONE, isActive: false } });
  });

  it('SUBSTITUTE: only the teacher the cover is assigned to — even when an admin shares the phone', async () => {
    profiles.resolve.mockResolvedValue([profile('u-head', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-ramesh', 'TEACHER', 'TEACHER')]);
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: 't-ramesh' });
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-1' })).toEqual({ ok: true, profile: expect.objectContaining({ userId: 'u-ramesh' }) });
    expect(db.substitution.findFirst).toHaveBeenCalledWith({ where: { id: 'sub-1', schoolId: A }, select: { substituteTeacherId: true } });
  });

  it('SUBSTITUTE on a gap nobody covers, or covered by someone else, is NOT_ALLOWED', async () => {
    profiles.resolve.mockResolvedValue([profile('u-kavya', 'TEACHER', 'TEACHER')]);
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: null });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-1' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: 't-ramesh' });
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-1' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
  });

  it('a "number" that is not a phone at all never reaches the profile lookup', async () => {
    expect(await svc().actorFor('hello', A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NO_PROFILE' });
    expect(profiles.resolve).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/whatsapp/inbound-identity.service.spec.ts`
Expected: FAIL — `Cannot find module './inbound-identity.service'`.

- [ ] **Step 3: Implement**

In `modules/auth/index.ts` add: `export { PhoneProfilesService, type PhoneProfile } from './internal/phone-profiles.service';` — in `auth.module.ts` change `exports: [PasswordService]` to `exports: [PasswordService, PhoneProfilesService]`.

Create `apps/api/src/modules/whatsapp/inbound-identity.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { toE164 } from '../../common/notifications/whatsapp/phone';
import { PhoneProfilesService, type PhoneProfile } from '../auth';
import { isLeaveDesk } from '../management';

export type InboundNeed = { kind: 'LEAVE_DESK' } | { kind: 'SUBSTITUTE'; substitutionId: string };
export type ActorResult =
  | { ok: true; profile: PhoneProfile }
  | { ok: false; why: 'NO_PROFILE' | 'NOT_ALLOWED' | 'AMBIGUOUS' | 'INACTIVE' };

type Db = ReturnType<typeof getPlatformPrisma>;

/**
 * WHO IS TAPPING — decided once, the same way login decides it.
 *
 * The login side already knew who is behind a phone (PhoneProfilesService);
 * the inbound side asked `user.findFirst` with no order, so two people on one
 * number meant whichever row Postgres returned first acted. Now the school
 * the PAYLOAD names (never the request) narrows the profiles, `need` filters
 * them, and exactly one eligible profile acts. None → NOT_ALLOWED, two or
 * more → AMBIGUOUS: nobody acts for a shared phone.
 */
@Injectable()
export class InboundIdentityService {
  constructor(private readonly profiles: PhoneProfilesService) {}

  async actorFor(phoneRaw: string, schoolId: string, need: InboundNeed): Promise<ActorResult> {
    const phone = toE164(phoneRaw);
    if (!phone) return { ok: false, why: 'NO_PROFILE' };
    const db = getPlatformPrisma();
    const profiles = await this.profiles.resolve(phone, { schoolId });
    if (profiles.length === 0) {
      const switchedOff = await db.user.count({ where: { schoolId, phone, isActive: false } });
      return { ok: false, why: switchedOff > 0 ? 'INACTIVE' : 'NO_PROFILE' };
    }
    const eligible = await this.eligible(db, schoolId, profiles, need);
    if (eligible.length === 1) return { ok: true, profile: eligible[0] };
    return { ok: false, why: eligible.length === 0 ? 'NOT_ALLOWED' : 'AMBIGUOUS' };
  }

  private async eligible(db: Db, schoolId: string, profiles: PhoneProfile[], need: InboundNeed): Promise<PhoneProfile[]> {
    if (need.kind === 'LEAVE_DESK') {
      const checks = await Promise.all(
        profiles.map(async (p) => ((p.kind === 'ADMIN' || p.kind === 'STAFF') && (await isLeaveDesk(db, schoolId, { userId: p.userId, role: p.role })) ? p : null)),
      );
      return checks.filter((p): p is PhoneProfile => p !== null);
    }
    const sub = await db.substitution.findFirst({ where: { id: need.substitutionId, schoolId }, select: { substituteTeacherId: true } });
    if (!sub?.substituteTeacherId) return [];
    const teacher = await db.teacher.findFirst({ where: { id: sub.substituteTeacherId, schoolId }, select: { userId: true } });
    return teacher?.userId ? profiles.filter((p) => p.userId === teacher.userId) : [];
  }
}
```

In `whatsapp.module.ts`: `import { AuthModule } from '../auth';`, add `AuthModule` to `imports`, add `InboundIdentityService` to `providers`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/whatsapp src/modules/auth src/common/module-wiring.spec.ts && pnpm boundary`
Expected: PASS; no boundary violation (whatsapp → auth and → management go through their barrels).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/whatsapp/inbound-identity.service.ts apps/api/src/modules/whatsapp/inbound-identity.service.spec.ts apps/api/src/modules/auth/index.ts apps/api/src/modules/auth/internal/auth.module.ts apps/api/src/modules/whatsapp/whatsapp.module.ts
git commit -m "feat(whatsapp): InboundIdentityService — one resolver for who is tapping; two people on one number act for neither"
```

---

### Task 8: Leave and cover taps act as the resolved person — admin or accounts officer

**Files:**
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.ts`
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts`

**Interfaces:**
- Consumes: `InboundIdentityService.actorFor` (Task 7).
- Produces: `WhatsAppActionsService` constructor `(leave: LeaveService, channel: WhatsAppChannel, identity: InboundIdentityService)`; inbound results `not-allowed` and `ambiguous` replace `not-admin`; `ack-not-substitute` stays.

- [ ] **Step 1: Write the failing tests**

In `whatsapp-actions.service.spec.ts`:

1. Add `const identity = { actorFor: jest.fn() };` beside `leave`, change the factory to `const svc = () => new WhatsAppActionsService(leave as never, channel as never, identity as never);`, and add to `beforeEach`: `identity.actorFor.mockResolvedValue({ ok: true, profile: { userId: 'admin-1', kind: 'ADMIN', role: 'SCHOOL_ADMIN' } });`

2. Replace the test `'a number that is not a verified admin of THAT school is answered, and nothing changes'` with:

```ts
  it('a number that cannot run the leave desk at THAT school is told so — the school named, the request not', async () => {
    identity.actorFor.mockResolvedValue({ ok: false, why: 'NOT_ALLOWED' });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('not-allowed');
    expect(identity.actorFor).toHaveBeenCalledWith('+919876543210', SCHOOL, { kind: 'LEAVE_DESK' });
    expect(leave.approve).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toBe('This number cannot do that at Raffles. Decide in the console.');
  });

  it('two people on one number: nothing changes, and the reply says why', async () => {
    identity.actorFor.mockResolvedValue({ ok: false, why: 'AMBIGUOUS' });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('ambiguous');
    expect(leave.approve).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toBe('Two people share this number here; decide in the console.');
  });

  it('the accounts officer approves on WhatsApp exactly as on the web — as herself', async () => {
    identity.actorFor.mockResolvedValue({ ok: true, profile: { userId: 'u-accounts', kind: 'STAFF', role: 'STAFF' } });
    leave.approve.mockResolvedValue({ gaps: 0, gapIds: [] });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('approved');
    expect(leave.approve).toHaveBeenCalledWith(SCHOOL, LEAVE, 'u-accounts');
  });

  it('a cover pick is a leave-desk act too', async () => {
    identity.actorFor.mockResolvedValue({ ok: false, why: 'NOT_ALLOWED' });
    db.substitution.findUnique.mockResolvedValue({ id: SUB, schoolId: SCHOOL, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1, substituteTeacherId: null });
    expect(await svc().handleInbound(tap(coverPayload(SUB, 'ta', actionKeys())))).toBe('not-allowed');
    expect(leave.assign).not.toHaveBeenCalled();
  });
```

3. Replace the test `'an acknowledgement is accepted only from the substitute themself'` with:

```ts
  it('an acknowledgement is accepted only from the substitute themself, and anyone else is answered with nothing', async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'ta' });
    identity.actorFor.mockResolvedValueOnce({ ok: false, why: 'NOT_ALLOWED' });
    expect(await svc().handleInbound(tap(ackPayload(SUB, actionKeys())))).toBe('ack-not-substitute');
    expect(sentTexts()).toEqual([]);
    identity.actorFor.mockResolvedValueOnce({ ok: true, profile: { userId: 'u-ta', kind: 'TEACHER', role: 'TEACHER' } });
    expect(await svc().handleInbound(tap(ackPayload(SUB, actionKeys()), 'wamid.4'))).toBe('acked');
    expect(identity.actorFor).toHaveBeenLastCalledWith('+919876543210', SCHOOL, { kind: 'SUBSTITUTE', substitutionId: SUB });
  });
```

4. In the test `'a cover pick runs LeaveService.assign; …'`, delete the line `db.user.findFirst.mockResolvedValue({ id: 'admin-1' });` (identity is mocked in `beforeEach`; after `jest.clearAllMocks()` re-arm it with `identity.actorFor.mockResolvedValue({ ok: true, profile: { userId: 'admin-1', kind: 'ADMIN', role: 'SCHOOL_ADMIN' } });`).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/whatsapp/whatsapp-actions.service.spec.ts`
Expected: FAIL — results are still `not-admin`; the officer is never asked about.

- [ ] **Step 3: Implement**

In `whatsapp-actions.service.ts`:

1. Constructor: add `private readonly identity: InboundIdentityService,` (import from `'./inbound-identity.service'`).
2. Delete `adminByPhone`.
3. Add these helpers in the helpers section:

```ts
  /**
   * The leave desk's door for a tap: exactly one admin or accounts officer of
   * the school the payload names. Anything else is answered in words that name
   * the school and never the request.
   */
  private async deskActor(db: Db, schoolId: string, phone: string): Promise<{ userId: string } | { refused: string }> {
    const who = await this.identity.actorFor(phone, schoolId, { kind: 'LEAVE_DESK' });
    if (who.ok) return { userId: who.profile.userId };
    if (who.why === 'AMBIGUOUS') {
      await this.text(schoolId, phone, 'Two people share this number here; decide in the console.');
      return { refused: 'ambiguous' };
    }
    const school = await db.school.findFirst({ where: { id: schoolId }, select: { name: true } });
    await this.text(schoolId, phone, `This number cannot do that at ${school?.name ?? 'this school'}. Decide in the console.`);
    return { refused: 'not-allowed' };
  }
```

4. In `onLeave` replace the `adminByPhone` block with:

```ts
    const actor = await this.deskActor(db, app.schoolId, phone);
    if ('refused' in actor) return { result: actor.refused, schoolId: app.schoolId };
```

and replace every `admin.id` in `onLeave` with `actor.userId`.

5. In `onCover` replace the `adminByPhone` block the same way (`const actor = await this.deskActor(db, sub.schoolId, phone); if ('refused' in actor) return { result: actor.refused, schoolId: sub.schoolId };`).

6. Replace `onAck` with:

```ts
  private async onAck(db: Db, a: Extract<Action, { kind: 'ack' }>, phone: string) {
    const sub = await db.substitution.findUnique({ where: { id: a.substitutionId }, select: { schoolId: true, substituteTeacherId: true } });
    if (!sub?.substituteTeacherId) return { result: 'gap-not-found', schoolId: sub?.schoolId ?? null };
    // Silent to anyone but the substitute: a stranger has nothing to decide here.
    const who = await this.identity.actorFor(phone, sub.schoolId, { kind: 'SUBSTITUTE', substitutionId: a.substitutionId });
    if (!who.ok) return { result: 'ack-not-substitute', schoolId: sub.schoolId };
    await this.text(sub.schoolId, phone, 'Noted — thank you.');
    return { result: 'acked', schoolId: sub.schoolId };
  }
```

7. Update the class docstring's "Who may tap" paragraph to: "Who may tap: the ONE person `InboundIdentityService` resolves for that school — an admin or the accounts officer for leave and cover (the web's rule), the substitute themself for an acknowledgement."

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/whatsapp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/whatsapp/whatsapp-actions.service.ts apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts
git commit -m "feat(whatsapp): leave and cover taps act as the one resolved desk person — the accounts officer can approve on WhatsApp"
```

---

### Task 9: Approve and reject are race-safe; the loser is told who decided; nobody decides their own leave

**Files:**
- Modify: `apps/api/src/common/errors/api-error.ts` (+ `LEAVE_OWN_DECISION`)
- Modify: `apps/api/src/modules/management/leave.service.ts` (`approve`, `reject`, `tellTeacherDecided`, new static helpers)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts`
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.ts` (`onLeave` catch)
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts`

**Interfaces:**
- Produces: `LeaveService.decidedSentence(status: string | undefined, byName: string | null, at: Date | null): string` (static, exported for tests); `ApiError('LEAVE_NOT_PENDING', 'Already approved by Darshan Jain at 9:42 am. Nothing changed.', 409)`; `ApiError('LEAVE_OWN_DECISION', …, 403)`. `approve()`/`reject()` signatures unchanged.

- [ ] **Step 1: Write the failing tests**

In `leave.service.spec.ts`: add `updateMany: jest.fn()` to `txMock.leaveApplication` and `findFirst: jest.fn().mockResolvedValue(null)` to `txMock.user`. In the top `beforeEach` add `txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });`. In `mockPendingLeave()` and in the auto-mark `beforeEach`, nothing else changes. Replace in the test `'generates a Substitution gap …'`:

```ts
      expect(txMock.leaveApplication.update).toHaveBeenCalledWith({
        where: { id: LEAVE_ID },
        data: expect.objectContaining({ status: 'APPROVED', reviewedById: ADMIN_USER }),
      });
```

with

```ts
      expect(txMock.leaveApplication.updateMany).toHaveBeenCalledWith({
        where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedById: ADMIN_USER, reviewedAt: expect.any(Date) },
      });
```

and in `'throws LEAVE_NOT_PENDING for an application that is not PENDING'` change `expect(txMock.leaveApplication.update).not.toHaveBeenCalled();` to `expect(txMock.leaveApplication.updateMany).not.toHaveBeenCalled();`. Then add inside `describe('approve', …)`:

```ts
    it('two desks approve at once: the one whose update finds no PENDING row is told who won, and when', async () => {
      mockPendingLeave();
      txMock.leaveApplication.updateMany.mockResolvedValue({ count: 0 });
      txMock.leaveApplication.findFirst
        .mockResolvedValueOnce({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') })
        .mockResolvedValueOnce({ status: 'APPROVED', reviewedById: 'u-head', reviewedAt: new Date('2026-07-20T04:12:00Z') });
      txMock.user.findFirst.mockResolvedValue({ name: 'Darshan Jain', email: 'head@x' });
      await expect(svc.approve(SCHOOL, LEAVE_ID, 'u-accounts')).rejects.toMatchObject({
        response: { code: 'LEAVE_NOT_PENDING', message: expect.stringMatching(/^Already approved by Darshan Jain at 9:42\s?am\. Nothing changed\.$/i) },
      });
      expect(txMock.substitution.create).not.toHaveBeenCalled();
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
      expect(txMock.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u-head', schoolId: SCHOOL }, select: { name: true, email: true } });
    });

    it('nobody decides their own leave — not the accounts officer, not an admin who teaches', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: null, staffId: 'staff-acc', status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') });
      txMock.staff.findFirst.mockResolvedValue({ userId: 'u-accounts' });
      await expect(svc.approve(SCHOOL, LEAVE_ID, 'u-accounts')).rejects.toMatchObject({ response: { code: 'LEAVE_OWN_DECISION' } });
      await expect(svc.reject(SCHOOL, LEAVE_ID, 'u-accounts')).rejects.toMatchObject({ response: { code: 'LEAVE_OWN_DECISION' } });
      expect(txMock.leaveApplication.updateMany).not.toHaveBeenCalled();
    });
```

and in `describe('LeaveService notices', …)` change the reject test's `txMock.leaveApplication.update.mockResolvedValue(...)` lines to `txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });` (both occurrences), then add a new test:

```ts
  it('the decision names the decider', async () => {
    txMock.leaveApplication.findFirst.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: 't1', status: 'PENDING', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21') });
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
    txMock.teacher.findFirst.mockResolvedValue({ userId: 'u-teacher' });
    txMock.user.findFirst.mockResolvedValue({ name: 'Darshan Jain', email: 'head@x' });
    await svc.reject('S', 'l1', 'u-admin');
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data.payload.byName).toBe('Darshan Jain');
  });
```

In `whatsapp-actions.service.spec.ts` replace the test `'Approve on an already-decided request says so and changes nothing'` with:

```ts
  it('Approve on an already-decided request says who decided, and changes nothing', async () => {
    leave.approve.mockRejectedValue(new ApiError('LEAVE_NOT_PENDING', 'Already rejected by Darshan Jain at 10:00 am. Nothing changed.', 409));
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('already-decided');
    expect(sentTexts()[0]).toBe('Already rejected by Darshan Jain at 10:00 am. Nothing changed.');
  });

  it('an officer tapping Approve on her own leave is told no, and nothing changes', async () => {
    leave.approve.mockRejectedValue(new ApiError('LEAVE_OWN_DECISION', 'You cannot decide your own leave. Another admin or the accounts officer has to.', 403));
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.own'))).toBe('own-leave');
    expect(sentTexts()[0]).toMatch(/cannot decide your own leave/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/leave.service.spec.ts src/modules/management/leave-staff.spec.ts src/modules/whatsapp`
Expected: FAIL — `updateMany` never called; no `LEAVE_OWN_DECISION`; the WhatsApp reply is the old "already rejected at" sentence.

- [ ] **Step 3: Implement**

In `api-error.ts`, after `'LEAVE_NOT_PENDING'` add:

```ts
  /** The decider is the applicant — nobody approves or rejects their own leave. Pair with 403. */
  | 'LEAVE_OWN_DECISION'
```

In `leave.service.ts` add these statics (below `whereIs`):

```ts
  /**
   * THE DECISION, RACE-SAFE. Two desks — the admin on the console, the
   * officer on WhatsApp — can tap within the same second. The update only
   * matches a row still PENDING, so Postgres lets exactly one through; the
   * other's update matches nothing and it is told who decided and when.
   */
  private static async decide(tx: TenantTx, schoolId: string, id: string, deciderUserId: string, to: 'APPROVED' | 'REJECTED') {
    const app = await tx.leaveApplication.findFirst({ where: { id, schoolId } });
    if (!app) throw new NotFoundException('Leave application not found');
    if (app.status !== 'PENDING') throw await LeaveService.alreadyDecided(tx, schoolId, id);
    await LeaveService.refuseOwn(tx, schoolId, app, deciderUserId);
    const { count } = await tx.leaveApplication.updateMany({
      where: { id, schoolId, status: 'PENDING' },
      data: { status: to, reviewedById: deciderUserId, reviewedAt: new Date() },
    });
    if (count === 0) throw await LeaveService.alreadyDecided(tx, schoolId, id);
    return app;
  }

  private static async refuseOwn(tx: TenantTx, schoolId: string, app: { teacherId: string | null; staffId: string | null }, deciderUserId: string): Promise<void> {
    const owner = app.teacherId
      ? await tx.teacher.findFirst({ where: { id: app.teacherId, schoolId }, select: { userId: true } })
      : app.staffId
        ? await tx.staff.findFirst({ where: { id: app.staffId, schoolId }, select: { userId: true } })
        : null;
    if (owner?.userId && owner.userId === deciderUserId) {
      throw new ApiError('LEAVE_OWN_DECISION', 'You cannot decide your own leave. Another admin or the accounts officer has to.', 403);
    }
  }

  /** The 409 for a decision that lost — read AFTER the winner committed, so it names the winner. */
  private static async alreadyDecided(tx: TenantTx, schoolId: string, id: string): Promise<ApiError> {
    const fresh = await tx.leaveApplication.findFirst({ where: { id, schoolId }, select: { status: true, reviewedById: true, reviewedAt: true } });
    const by = fresh?.reviewedById ? await LeaveService.nameOf(tx, schoolId, fresh.reviewedById) : null;
    return new ApiError('LEAVE_NOT_PENDING', LeaveService.decidedSentence(fresh?.status, by, fresh?.reviewedAt ?? null), 409);
  }

  private static async nameOf(tx: TenantTx, schoolId: string, userId: string): Promise<string | null> {
    const u = await tx.user.findFirst({ where: { id: userId, schoolId }, select: { name: true, email: true } });
    return u ? (u.name?.trim() || u.email.split('@')[0]) : null;
  }

  /** "Already approved by Darshan Jain at 9:42 am. Nothing changed." */
  static decidedSentence(status: string | undefined, byName: string | null, at: Date | null): string {
    const word = status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : status === 'CANCELLED' ? 'withdrawn' : 'decided';
    const by = byName ? ` by ${byName}` : '';
    // ICU writes a narrow no-break space before "am" on newer Node; a chat reads a plain one.
    const when = at ? ` at ${at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).toLowerCase().replace(/\s+/g, ' ')}` : '';
    return `Already ${word}${by}${when}. Nothing changed.`;
  }
```

Replace the head of `reject` (from `const app = …` through the `tx.leaveApplication.update(...)` call) with:

```ts
      const app = await LeaveService.decide(tx, schoolId, id, adminUserId, 'REJECTED');
```

and its `return updated;` with `return { ...app, status: 'REJECTED' as const };`.

Replace the head of `approve` (from `const app = …` through the `tx.leaveApplication.update(...)` call) with:

```ts
      const app = await LeaveService.decide(tx, schoolId, id, adminUserId, 'APPROVED');
```

In `tellTeacherDecided` replace `byName: null as string | null,` with `byName: await LeaveService.nameOf(tx, schoolId, adminUserId),`.

In `whatsapp-actions.service.ts` replace the `catch (e)` of `onLeave` with:

```ts
    } catch (e) {
      const code = apiCode(e);
      if (code === 'LEAVE_NOT_PENDING' || code === 'LEAVE_OWN_DECISION') {
        // The service's own sentence: who decided and when, or why not you.
        await this.text(app.schoolId, phone, (e as ApiError).message);
        return { result: code === 'LEAVE_NOT_PENDING' ? 'already-decided' : 'own-leave', schoolId: app.schoolId };
      }
      throw e;
    }
```

(`HttpException.message` is the message passed in the response object — `ApiError` sets it.) Also change `select` in the `onLeave` lookup to drop `reviewedById, reviewedAt` (no longer read there).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management src/modules/whatsapp`
Expected: PASS. If `(e as ApiError).message` is the generic "Http Exception", read it from `(e.getResponse() as { message: string }).message` instead — the test pins the exact sentence.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/errors/api-error.ts apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts apps/api/src/modules/whatsapp/whatsapp-actions.service.ts apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts
git commit -m "fix(leave): approve/reject match only a PENDING row — the losing desk is told who decided and when; nobody decides their own leave"
```

---

### Task 10: Gate, push, staging

- [ ] **Step 1:** `pnpm preflight` — expect green. A red test is fixed, not skipped.
- [ ] **Step 2:** One fresh reviewer (most capable model) on `git diff origin/staging..HEAD`, with this plan and the spec. Fix what it finds; re-run preflight.
- [ ] **Step 3:** `git fetch origin && git log --oneline origin/staging..HEAD`; push the branch (`git push -u origin HEAD`); open a PR to `staging` with `gh pr create --base staging` (title "Notification spine Tier 1a: deliveries, identity, race-safe leave decisions"; body: the task list, the template-submission output from Task 1 Step 8, and "Migration `20261007_000000_notification_delivery` — staging applies on push; prod before the staging→main merge"). Wait for CI; merge.
- [ ] **Step 4:** On staging, once `db-migrate` has run: `curl -s https://api.test.sckools.com/ready`; apply for leave as a Ladwa teacher and, within a minute, read `NotificationDelivery` for that outbox row (three rows per desk person — PUSH, WHATSAPP, EMAIL — each SENT or SKIPPED with a reason) and see the outbox row's `sentAt` set; tap Approve from the officer's verified WhatsApp and see the leave APPROVED with `reviewedById` = the officer.
- [ ] **Step 5:** Tell the owner: (a) `WHATSAPP_WABA_ID` must be set on `skoolos-api` Production and Preview, or the gated templates never go; (b) run the prod migration before merging staging→main; (c) the template review status (`node scripts/whatsapp-verify.mjs`).
