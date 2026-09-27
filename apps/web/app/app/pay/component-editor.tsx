'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Field, FieldRow, Overlay } from '@/components/ui/kit';
import { Note } from './ui';
import type { Component } from './types';

const CALC_LABEL: Record<Component['calc'], string> = {
  FIXED: 'A fixed amount',
  PCT_OF_BASIC: 'A share of Basic',
  PCT_OF_GROSS: 'A share of gross',
  BALANCE: 'Whatever is left',
};

/**
 * EDITING A PART OF A SALARY.
 *
 * Two kinds of change live here and they are not equally safe:
 *
 *  · The NAME and the NOTE are what a person reads on their payslip. Changing
 *    them costs nothing.
 *  · "Counts as wages" and "provident fund" decide what PF, ESI and gratuity
 *    are worked out ON. Changing one changes what the school and the person
 *    pay, from the next month that is worked out — so it is said plainly,
 *    above the controls, rather than discovered in a filing.
 *
 * The share is in basis points on the wire and a percentage on the screen,
 * because 12.5% is how a school says it and 1250 is how the maths keeps it
 * exact.
 */
export default function ComponentEditor({ component, onClose }: { component: Component; onClose: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [name, setName] = useState(component.name);
  const [hint, setHint] = useState(component.hint ?? '');
  const [pct, setPct] = useState(component.rateBps == null ? '' : String(component.rateBps / 100));
  const [isWages, setIsWages] = useState(component.isWages);
  const [retirementBase, setRetirementBase] = useState(component.retirementBase);
  const [active, setActive] = useState(component.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usesRate = component.calc === 'PCT_OF_BASIC' || component.calc === 'PCT_OF_GROSS';
  const pctNumber = Number(pct);
  const pctInvalid = usesRate && (!Number.isFinite(pctNumber) || pctNumber < 0 || pctNumber > 100);
  const statutoryChanged = isWages !== component.isWages || retirementBase !== component.retirementBase;

  async function save() {
    if (pctInvalid) return;
    setSaving(true); setError(null);
    try {
      // A full upsert keyed by `key` — the server has no partial update for a
      // component, and sending only what changed would blank the rest.
      await api.post('/payroll/components', {
        key: component.key,
        name: name.trim() || component.name,
        kind: component.kind,
        calc: component.calc,
        ...(usesRate ? { rateBps: Math.round(pctNumber * 100) } : {}),
        taxable: component.taxable,
        isWages,
        retirementBase,
        healthBase: component.healthBase,
        gratuityBase: component.gratuityBase,
        prorate: component.prorate,
        order: component.order,
        active,
        hint: hint.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['salary-components'] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      setSaving(false);
    }
  }

  return (
    <Overlay
      title={component.name}
      subtitle={CALC_LABEL[component.calc]}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sk-btn" onClick={onClose}>Cancel</button>
          <button
            type="button" className="sk-btn sk-press" data-variant="primary"
            disabled={saving || pctInvalid}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <FieldRow min={200}>
          <Field id="comp-name" label="What it is called" hint="This is what a person reads on their payslip.">
            {(p) => <input {...p} className="sk-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
          </Field>
          {usesRate ? (
            <Field
              id="comp-pct"
              label={component.calc === 'PCT_OF_BASIC' ? 'Share of Basic' : 'Share of gross'}
              hint="A percentage — 12.5 means twelve and a half."
              invalid={pctInvalid}
            >
              {(p) => (
                <input
                  {...p} className="sk-input" type="number" min={0} max={100} step="0.01" inputMode="decimal"
                  value={pct} onChange={(e) => setPct(e.target.value)}
                />
              )}
            </Field>
          ) : null}
        </FieldRow>

        <Field id="comp-hint" label="A note under the name" hint="Optional. Something short that explains it.">
          {(p) => <input {...p} className="sk-input" value={hint} maxLength={200} onChange={(e) => setHint(e.target.value)} />}
        </Field>

        <label className="flex items-start gap-2" style={{ fontSize: 13 }}>
          <input type="checkbox" className="sk-paycheck" checked={isWages} onChange={(e) => setIsWages(e.target.checked)} />
          <span>
            Counts as wages
            <span className="sk-muted" style={{ display: 'block', fontSize: 12 }}>
              Wages decide the half of pay the Code on Wages asks for, and what gratuity is worked out on.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2" style={{ fontSize: 13 }}>
          <input type="checkbox" className="sk-paycheck" checked={retirementBase} onChange={(e) => setRetirementBase(e.target.checked)} />
          <span>
            Provident fund is worked out on it
            <span className="sk-muted" style={{ display: 'block', fontSize: 12 }}>
              Both the person&rsquo;s 12% and the school&rsquo;s.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2" style={{ fontSize: 13 }}>
          <input type="checkbox" className="sk-paycheck" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>
            In use
            <span className="sk-muted" style={{ display: 'block', fontSize: 12 }}>
              Turning it off leaves every month already worked out exactly as it was.
            </span>
          </span>
        </label>

        {statutoryChanged ? (
          <Note>
            <p style={{ margin: 0 }}>
              This changes what provident fund and ESI are worked out on, from the next month you work out. Months
              already locked keep the figures they were filed with.
            </p>
          </Note>
        ) : null}
        {error ? <p className="sk-state err">{error}</p> : null}
      </div>
    </Overlay>
  );
}
