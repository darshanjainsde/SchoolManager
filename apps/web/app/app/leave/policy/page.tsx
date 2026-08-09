'use client';
import { useState, type CSSProperties, type FocusEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LeaveAllocationGrid, LeaveTypeDefRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface AcademicYear {
  id: string;
  name: string;
  isCurrent: boolean;
}

// Mirrors the leave page's themed field styling.
const fieldStyle: CSSProperties = {
  display: 'block',
  border: '1px solid var(--sk-line-2)',
  borderRadius: 10,
  padding: '8px 10px',
  background: 'var(--sk-card)',
  color: 'var(--sk-ink)',
  fontSize: 13,
  fontFamily: 'inherit',
  transition: 'border-color 0.12s, box-shadow 0.12s',
};
const numStyle: CSSProperties = { ...fieldStyle, width: 64, textAlign: 'center' };

function ringFocus(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-brand)';
  e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--sk-brand) 18%, transparent)';
}
function ringBlur(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-line-2)';
  e.currentTarget.style.boxShadow = 'none';
}

/** One editable leave-type row — local draft, explicit Save. */
function TypeRow({
  def,
  onSave,
  saving,
}: {
  def: LeaveTypeDefRow;
  onSave: (patch: Partial<LeaveTypeDefRow>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(def.name);
  const [defaultAnnual, setDefaultAnnual] = useState(String(def.defaultAnnual));
  const [carryForwardCap, setCarryForwardCap] = useState(String(def.carryForwardCap));
  const [isPaid, setIsPaid] = useState(def.isPaid);
  const [isActive, setIsActive] = useState(def.isActive);

  const dirty =
    name !== def.name ||
    Number(defaultAnnual) !== def.defaultAnnual ||
    Number(carryForwardCap) !== def.carryForwardCap ||
    isPaid !== def.isPaid ||
    isActive !== def.isActive;

  return (
    <div className="sk-row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <input
        aria-label={`Name for ${def.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={ringFocus}
        onBlur={ringBlur}
        style={{ ...fieldStyle, minWidth: 150, flex: 1 }}
      />
      <label className="sk-lab" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />
        Paid
      </label>
      <label className="sk-lab" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        Days/year
        <input
          type="number"
          min={0}
          max={366}
          value={defaultAnnual}
          onChange={(e) => setDefaultAnnual(e.target.value)}
          onFocus={ringFocus}
          onBlur={ringBlur}
          style={numStyle}
        />
      </label>
      <label className="sk-lab" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        Carry-forward cap
        <input
          type="number"
          min={0}
          max={366}
          value={carryForwardCap}
          onChange={(e) => setCarryForwardCap(e.target.value)}
          onFocus={ringFocus}
          onBlur={ringBlur}
          style={numStyle}
        />
      </label>
      <label className="sk-lab" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>
      <span className="sp" />
      <button
        type="button"
        className="sk-btn"
        disabled={!dirty || saving}
        onClick={() =>
          onSave({
            name: name.trim(),
            isPaid,
            isActive,
            defaultAnnual: Math.max(0, Number(defaultAnnual) || 0),
            carryForwardCap: Math.max(0, Number(carryForwardCap) || 0),
          })
        }
      >
        Save
      </button>
    </div>
  );
}

/** One grid cell: shows left/allotted + used; the allotted figure is editable. */
function AllocationCell({
  allotted,
  used,
  remaining,
  onSave,
  label,
}: {
  allotted: number | null;
  used: number;
  remaining: number | null;
  onSave: (allotted: number) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (editing) {
    return (
      <input
        aria-label={label}
        type="number"
        min={0}
        max={366}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={ringFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(Math.max(0, Number(draft) || 0));
            setEditing(false);
          }
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => {
          onSave(Math.max(0, Number(draft) || 0));
          setEditing(false);
        }}
        style={{ ...numStyle, width: 56 }}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        setDraft(String(allotted ?? 0));
        setEditing(true);
      }}
      style={{
        background: 'none',
        border: '1px dashed transparent',
        borderRadius: 8,
        padding: '4px 8px',
        cursor: 'pointer',
        color: 'var(--sk-ink)',
        fontSize: 12.5,
        lineHeight: 1.3,
        textAlign: 'center',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--sk-line-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
    >
      {allotted === null ? (
        <span className="sk-muted">—{used > 0 ? ` · ${used} used` : ''}</span>
      ) : (
        <>
          <strong style={{ color: remaining !== null && remaining < 0 ? 'var(--sk-bad)' : undefined }}>
            {remaining}
          </strong>
          <span className="sk-muted"> / {allotted}</span>
          {used > 0 && <div className="sk-muted" style={{ fontSize: 10.5 }}>{used} used</div>}
        </>
      )}
    </button>
  );
}

export default function LeavePolicyPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [newType, setNewType] = useState('');
  const [closeTo, setCloseTo] = useState('');

  const types = useQuery({
    queryKey: ['leave-types'],
    enabled: !!host,
    queryFn: () => api.get<LeaveTypeDefRow[]>('/manage/leave-policy/types'),
  });
  const grid = useQuery({
    queryKey: ['leave-grid'],
    enabled: !!host,
    queryFn: () => api.get<LeaveAllocationGrid>('/manage/leave-policy/allocations'),
  });
  const years = useQuery({
    queryKey: ['leave-years'],
    enabled: !!host,
    queryFn: () => api.get<AcademicYear[]>('/manage/years'),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['leave-types'] });
    void qc.invalidateQueries({ queryKey: ['leave-grid'] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const saveType = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<LeaveTypeDefRow> }) =>
      api.patch(`/manage/leave-policy/types/${id}`, patch),
    onSuccess: () => {
      toast.success('Leave type saved.');
      refresh();
    },
    onError,
  });
  const addType = useMutation({
    mutationFn: (name: string) => api.post('/manage/leave-policy/types', { name }),
    onSuccess: () => {
      setNewType('');
      toast.success('Leave type added — set its quota below.');
      refresh();
    },
    onError,
  });
  const applyDefaults = useMutation({
    mutationFn: () => api.post<{ created: number }>('/manage/leave-policy/allocations/apply-defaults', {}),
    onSuccess: (r) => {
      toast.success(
        r.created === 0
          ? 'Everyone already has their grants — nothing to add.'
          : `Granted default quotas — ${r.created} new ${r.created === 1 ? 'entry' : 'entries'}.`,
      );
      refresh();
    },
    onError,
  });
  const setAllocation = useMutation({
    mutationFn: (v: { teacherId: string; typeDefId: string; academicYearId: string; allotted: number }) =>
      api.put('/manage/leave-policy/allocations', v),
    onSuccess: refresh,
    onError,
  });
  const closeYear = useMutation({
    mutationFn: (v: { fromAcademicYearId: string; toAcademicYearId: string }) =>
      api.post<{ carried: number }>('/manage/leave-policy/close-year', v),
    onSuccess: (r) => {
      toast.success(`Year closed — carried balances for ${r.carried} ${r.carried === 1 ? 'grant' : 'grants'}.`);
      refresh();
    },
    onError,
  });

  const g = grid.data;
  const currentYearId = g?.academicYear.id;
  const otherYears = (years.data ?? []).filter((y) => y.id !== currentYearId);

  return (
    <>
      <header className="sk-pagehead">
        <div>
          <h1>Leave policy</h1>
          <p>Leave types, yearly quotas, and each teacher&rsquo;s allotment.</p>
        </div>
        <Link href="/app/leave" className="sk-btn">
          ← Back to leave
        </Link>
      </header>

      {/* Types */}
      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Leave types</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            Days/year is what &ldquo;Grant default quotas&rdquo; gives everyone. The carry-forward cap is how
            many unused days survive a year close — 0 means they lapse.
          </p>
        </div>
        <div className="sk-card-b">
          {types.isLoading && <p className="sk-state">Loading leave types…</p>}
          {types.error && <p className="sk-state err">{(types.error as Error).message}</p>}
          {(types.data ?? []).map((def) => (
            <TypeRow
              key={def.id}
              def={def}
              saving={saveType.isPending}
              onSave={(patch) => saveType.mutate({ id: def.id, patch })}
            />
          ))}
          <form
            style={{ display: 'flex', gap: 8, marginTop: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newType.trim()) addType.mutate(newType.trim());
            }}
          >
            <input
              aria-label="New leave type name"
              placeholder="Add a type — e.g. Maternity leave"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onFocus={ringFocus}
              onBlur={ringBlur}
              style={{ ...fieldStyle, flex: 1, maxWidth: 320 }}
            />
            <button type="submit" className="sk-btn" disabled={!newType.trim() || addType.isPending}>
              Add type
            </button>
          </form>
        </div>
      </div>

      {/* Allotment grid */}
      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div
          className="sk-card-h"
          style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
        >
          <div>
            <h3>Allotments{g ? ` · ${g.academicYear.name}` : ''}</h3>
            <p className="sk-muted" style={{ marginTop: 4 }}>
              Each cell reads <strong>left / allotted</strong> — used days are counted from approved leave, so
              a cancellation refunds itself. Click a figure to change the grant.
            </p>
          </div>
          <button type="button" className="sk-btn" disabled={applyDefaults.isPending} onClick={() => applyDefaults.mutate()}>
            Grant default quotas
          </button>
        </div>
        <div className="sk-card-b" style={{ overflowX: 'auto' }}>
          {grid.isLoading && <p className="sk-state">Loading allotments…</p>}
          {grid.error && <p className="sk-state err">{(grid.error as Error).message}</p>}
          {g && g.teachers.length === 0 && <p className="sk-state">No active teachers yet.</p>}
          {g && g.teachers.length > 0 && (
            <table style={{ borderCollapse: 'collapse', minWidth: 480 }}>
              <thead>
                <tr>
                  <th className="sk-lab" style={{ textAlign: 'left', padding: '6px 10px 6px 0' }}>
                    Teacher
                  </th>
                  {g.types.map((t) => (
                    <th key={t.id} className="sk-lab" style={{ padding: '6px 10px', textAlign: 'center' }}>
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.teachers.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--sk-line)' }}>
                    <td style={{ padding: '8px 10px 8px 0', fontSize: 13, fontWeight: 650, whiteSpace: 'nowrap' }}>
                      {t.name}
                    </td>
                    {t.cells.map((c) => (
                      <td key={c.typeDefId} style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <AllocationCell
                          allotted={c.allotted}
                          used={c.used}
                          remaining={c.remaining}
                          label={`${t.name} — ${g.types.find((x) => x.id === c.typeDefId)?.name ?? 'type'} allotment`}
                          onSave={(allotted) =>
                            currentYearId &&
                            setAllocation.mutate({
                              teacherId: t.id,
                              typeDefId: c.typeDefId,
                              academicYearId: currentYearId,
                              allotted,
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Year close */}
      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Close the year</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            Carries each teacher&rsquo;s unused days into the chosen year, up to each type&rsquo;s
            carry-forward cap. Days above the cap lapse. Run it once, at year end.
          </p>
        </div>
        <div className="sk-card-b" style={{ flexDirection: 'row', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="sk-lab">From {g?.academicYear.name ?? '…'} into</span>
          <select
            aria-label="Year to carry balances into"
            value={closeTo}
            onChange={(e) => setCloseTo(e.target.value)}
            onFocus={ringFocus}
            onBlur={ringBlur}
            style={fieldStyle}
          >
            <option value="">— Pick a year —</option>
            {otherYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="sk-btn"
            disabled={!closeTo || !currentYearId || closeYear.isPending}
            onClick={() =>
              currentYearId && closeYear.mutate({ fromAcademicYearId: currentYearId, toAcademicYearId: closeTo })
            }
          >
            Carry balances forward
          </button>
        </div>
      </div>
    </>
  );
}
