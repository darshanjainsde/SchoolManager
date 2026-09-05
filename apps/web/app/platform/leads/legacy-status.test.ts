// @vitest-environment node
//
// The pipeline migration is expand-only: it ADDS stages and keeps the
// pre-pipeline CLOSED rather than rewriting those rows to LOST. That choice is
// what makes the migration safe to run against a live database before its code
// ships, and reversible afterwards — but it means CLOSED keeps arriving from
// the API forever, and every read path has to survive it.
//
// Folding CLOSED into LOST in the database would delete the evidence that it
// was ever closed rather than lost, and could not be undone. So the handling
// lives here instead, and this test is what stops it being quietly removed by
// someone who reads the stage list and concludes CLOSED is dead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DONE_STAGES,
  LEAD_STAGES,
  STAGE_LABEL,
  displayColumn,
  followUpTone,
  type LeadStage,
} from '../_lib/leads';

describe('the legacy CLOSED stage stays handled', () => {
  it('is not a column — the board has exactly the six pipeline stages', () => {
    expect([...LEAD_STAGES]).toEqual(['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO', 'WON', 'LOST']);
    expect(LEAD_STAGES).not.toContain('CLOSED');
  });

  it('is displayed under Lost, so such a lead is never invisible', () => {
    // Dropping this mapping would file every legacy lead into a column that
    // does not exist, and the board would silently render fewer leads than the
    // count above it claims.
    expect(displayColumn('CLOSED')).toBe('LOST');
    for (const s of LEAD_STAGES) expect(displayColumn(s)).toBe(s);
  });

  it('has a label, or the card renders a blank stage', () => {
    expect(STAGE_LABEL.CLOSED).toMatch(/legacy/i);
  });

  it('counts as done, so a stale follow-up date cannot make it overdue', () => {
    const longPast = new Date(Date.now() - 86_400_000).toISOString();
    expect(followUpTone(longPast, 'CLOSED')).toBeNull();
    expect(followUpTone(longPast, 'WON')).toBeNull();
    expect(followUpTone(longPast, 'LOST')).toBeNull();
    // A lead still being worked with a past date IS overdue — the guard above
    // must not have simply disabled the feature.
    expect(followUpTone(longPast, 'CONTACTED')).toBe('due');
  });

  it('is in DONE_STAGES alongside the two real terminals', () => {
    expect([...DONE_STAGES].sort()).toEqual(['CLOSED', 'LOST', 'WON']);
  });

  it('is still accepted by the API, so the older console keeps working', () => {
    // The console deployed before this change sends CLOSED on every status
    // change. Narrowing the DTO to the six pipeline stages would turn this
    // release into a breaking one for a client that is still live.
    const dto = readFileSync(
      resolve(process.cwd(), '../api/src/modules/marketing/marketing.dto.ts'),
      'utf8',
    );
    const accepted = dto.slice(dto.indexOf('export const LEAD_STATUSES'));
    expect(accepted.slice(0, accepted.indexOf(']'))).toContain("'CLOSED'");
  });

  it('is never written by the migration — no row rewrite, nothing to undo', () => {
    const sql = readFileSync(
      resolve(process.cwd(), '../../packages/db/prisma/migrations/20260905_000000_lead_pipeline/migration.sql'),
      'utf8',
    );
    const code = sql.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/UPDATE\s+"MarketingLead"\s+SET\s+"status"/i);
    expect(code).not.toMatch(/DROP\s+TYPE/i);
    // Additive only: the enum is extended, never recreated under the column.
    expect(code).toMatch(/ALTER TYPE "LeadStatus" ADD VALUE/);
  });
});

// A cheap belt-and-braces check that the union really does admit the value —
// this fails to compile, not at runtime, if LeadStage stops including CLOSED.
const _legacyIsAStage: LeadStage = 'CLOSED';
void _legacyIsAStage;
