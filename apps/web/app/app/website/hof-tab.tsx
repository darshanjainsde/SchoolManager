'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CourseRow } from './courses-tab';

/* ── Contracts (apps/api/src/modules/cms/internal/hall-of-fame.*) ─────────── */
type GroupKind = 'COURSE' | 'GRADES' | 'CUSTOM';
interface HofGroup {
  id: string;
  kind: GroupKind;
  label: string;
  order: number;
  courseId: string | null;
  gradeIds: string[];
  sectionIds: string[];
}
interface HofEntry {
  id: string;
  groupId: string;
  batchYear: number;
  rank: number;
  name: string;
  achievement: string | null;
  photoAssetId: string | null;
  studentId: string | null;
}
interface HofOverview {
  groups: HofGroup[];
  entries: HofEntry[];
  years: number[];
  currentYear: number;
  settings: { landingYear: number | null; pastBatches: number };
  unavailable: boolean;
}
/** /manage/classes — every scalar of ClassSection plus the grade's name. */
interface ClassRow {
  id: string;
  name: string;
  gradeId: string;
  grade: { name: string } | null;
}
/** /manage/students?classSectionId= — ROSTER_SELECT. */
interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  rollNo: string | null;
}
interface MediaAsset {
  id: string;
  url: string;
}
interface SiteContent {
  school?: { features?: string[] } | null;
}

/** A group being edited. `key` is local; `id` is set once the API has it. */
interface GroupDraft {
  key: string;
  id?: string;
  kind: GroupKind;
  label: string;
  courseId: string;
  gradeIds: string[];
  sectionIds: string[];
}
interface SlotForm {
  name: string;
  achievement: string;
  photoAssetId: string | null;
  photoPreviewUrl: string | null;
  studentId: string | null;
}
const EMPTY_SLOT: SlotForm = { name: '', achievement: '', photoAssetId: null, photoPreviewUrl: null, studentId: null };
const MEDALS = ['🥇', '🥈', '🥉'];
const PLACES = ['1st', '2nd', '3rd'];
const KIND_LABEL: Record<GroupKind, string> = { COURSE: 'Website course', GRADES: 'Class', CUSTOM: 'Custom' };

let draftSeq = 0;
const newKey = () => `d${++draftSeq}`;

function toDrafts(groups: HofGroup[]): GroupDraft[] {
  return groups.map((g) => ({ key: g.id, id: g.id, kind: g.kind, label: g.label, courseId: g.courseId ?? '', gradeIds: g.gradeIds, sectionIds: g.sectionIds }));
}

/** The label the API will give a draft when the admin leaves it blank. */
function autoLabel(d: GroupDraft, courses: CourseRow[], classes: ClassRow[]): string {
  if (d.kind === 'COURSE') return courses.find((c) => c.id === d.courseId)?.name ?? '';
  if (d.kind === 'GRADES') {
    if (d.sectionIds.length) {
      return d.sectionIds
        .map((id) => classes.find((c) => c.id === id))
        .filter((c): c is ClassRow => !!c)
        .map((c) => `${c.grade?.name ?? ''}-${c.name}`)
        .join(' · ');
    }
    const names = new Map<string, string>();
    for (const c of classes) if (d.gradeIds.includes(c.gradeId) && c.grade) names.set(c.gradeId, c.grade.name);
    return d.gradeIds.map((id) => names.get(id) ?? '').filter(Boolean).join(' · ');
  }
  return '';
}

export default function HallOfFameTab() {
  // Every tenant-scoped query waits for the host (host-guard.test.ts) and the
  // client carries it as the tenant header (tenant-host.test.ts).
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const hofQuery = useQuery({
    queryKey: ['site-hof'],
    queryFn: () => api.get<HofOverview>('/site/hall-of-fame'),
    enabled: !!host,
  });
  const coursesQuery = useQuery({
    queryKey: ['site-courses'],
    queryFn: () => api.get<CourseRow[]>('/site/courses'),
    enabled: !!host,
  });
  const contentQuery = useQuery({
    queryKey: ['site-content'],
    queryFn: () => api.get<SiteContent>('/site/content'),
    enabled: !!host,
  });
  const mediaQuery = useQuery({
    queryKey: ['site-media-hof'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=HOF'),
    enabled: !!host,
  });
  const hasManagement = (contentQuery.data?.school?.features ?? []).includes('MANAGEMENT');
  const classesQuery = useQuery({
    queryKey: ['manage-classes'],
    queryFn: () => api.get<ClassRow[]>('/manage/classes'),
    enabled: !!host && hasManagement,
  });

  const hof = hofQuery.data;
  const courses = coursesQuery.data ?? [];
  const classes = classesQuery.data ?? [];
  const photoUrl = (id?: string | null) => (id ? (mediaQuery.data?.find((a) => a.id === id)?.url ?? null) : null);

  // ── Batch year ──
  const [year, setYear] = useState<number | null>(null);
  const [newYear, setNewYear] = useState<string>('');
  const [addingYear, setAddingYear] = useState(false);
  const activeYear = year ?? hof?.years[0] ?? hof?.currentYear ?? new Date().getFullYear();
  const yearChips = useMemo(() => {
    const ys = new Set<number>(hof?.years ?? []);
    if (year != null) ys.add(year);
    return [...ys].sort((a, b) => b - a);
  }, [hof?.years, year]);

  // ── Groups (editable copy) ──
  const [drafts, setDrafts] = useState<GroupDraft[] | null>(null);
  const groupDrafts = drafts ?? toDrafts(hof?.groups ?? []);
  const groupsDirty = drafts !== null;
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const savedGroups = hof?.groups ?? [];
  const activeGroup = savedGroups.find((g) => g.id === activeGroupKey) ?? savedGroups[0];

  // ── Podium slots for (activeGroup, activeYear) ──
  const [slots, setSlots] = useState<SlotForm[]>([EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT]);
  useEffect(() => {
    const entries = (hof?.entries ?? []).filter((e) => e.groupId === activeGroup?.id && e.batchYear === activeYear);
    setSlots(
      [1, 2, 3].map((rank) => {
        const e = entries.find((x) => x.rank === rank);
        return e
          ? { name: e.name, achievement: e.achievement ?? '', photoAssetId: e.photoAssetId, photoPreviewUrl: null, studentId: e.studentId }
          : EMPTY_SLOT;
      }),
    );
  }, [hof?.entries, activeGroup?.id, activeYear]);

  // ── Settings ──
  const [landing, setLanding] = useState<string | null>(null);
  const [pastBatches, setPastBatches] = useState<string | null>(null);
  const landingValue = landing ?? (hof?.settings.landingYear == null ? 'latest' : String(hof.settings.landingYear));
  const pastValue = pastBatches ?? String(hof?.settings.pastBatches ?? 4);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['site-hof'] });
    void queryClient.invalidateQueries({ queryKey: ['site-media-hof'] });
  };
  const fail = (what: string) => (err: Error) => toast.error(`${what} failed: ${err.message}`);

  const saveGroups = useMutation({
    mutationFn: () =>
      api.put<HofOverview>('/site/hall-of-fame/groups', {
        groups: groupDrafts.map((d) => ({
          ...(d.id ? { id: d.id } : {}),
          kind: d.kind,
          label: d.label.trim() || undefined,
          ...(d.kind === 'COURSE' ? { courseId: d.courseId } : {}),
          ...(d.kind === 'GRADES' ? { gradeIds: d.gradeIds, sectionIds: d.sectionIds } : {}),
        })),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['site-hof'], data);
      setDrafts(null);
      setConfirmRemove(null);
      toast.success('Groups saved');
    },
    onError: fail('Saving groups'),
  });

  const savePodium = useMutation({
    mutationFn: () => {
      if (!activeGroup) throw new Error('Pick a group first');
      return api.put<HofOverview>(`/site/hall-of-fame/groups/${activeGroup.id}/${activeYear}`, {
        entries: slots
          .map((s, i) => ({ ...s, rank: i + 1 }))
          .filter((s) => s.name.trim() || s.studentId)
          .map((s) => ({
            rank: s.rank,
            name: s.name.trim() || undefined,
            achievement: s.achievement.trim() || undefined,
            photoAssetId: s.photoAssetId ?? undefined,
            studentId: s.studentId ?? undefined,
          })),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['site-hof'], data);
      invalidate();
      toast.success(`Batch of ${activeYear} saved`);
    },
    onError: fail('Saving the podium'),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api.put<HofOverview>('/site/hall-of-fame/settings', {
        landingYear: landingValue === 'latest' ? null : Number(landingValue),
        pastBatches: Math.min(10, Math.max(1, Number(pastValue) || 4)),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['site-hof'], data);
      setLanding(null);
      setPastBatches(null);
      toast.success('Settings saved');
    },
    onError: fail('Saving settings'),
  });

  function updateDraft(key: string, patch: Partial<GroupDraft>) {
    setDrafts((prev) => (prev ?? toDrafts(savedGroups)).map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function addDraft(kind: GroupKind) {
    setDrafts((prev) => [...(prev ?? toDrafts(savedGroups)), { key: newKey(), kind, label: '', courseId: courses[0]?.id ?? '', gradeIds: [], sectionIds: [] }]);
  }
  function removeDraft(key: string) {
    setDrafts((prev) => (prev ?? toDrafts(savedGroups)).filter((d) => d.key !== key));
    setConfirmRemove(null);
  }
  function moveDraft(key: string, dir: -1 | 1) {
    setDrafts((prev) => {
      const list = [...(prev ?? toDrafts(savedGroups))];
      const i = list.findIndex((d) => d.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      [list[i], list[j]] = [list[j], list[i]];
      return list;
    });
  }
  /** One clubbed grade group → one group per section of that grade. */
  function splitBySection(key: string) {
    setDrafts((prev) => {
      const list = prev ?? toDrafts(savedGroups);
      const i = list.findIndex((d) => d.key === key);
      if (i < 0) return list;
      const d = list[i];
      const secs = classes.filter((c) => d.gradeIds.includes(c.gradeId));
      if (secs.length < 2) return list;
      const split = secs.map((c) => ({ key: newKey(), kind: 'GRADES' as const, label: '', courseId: '', gradeIds: [c.gradeId], sectionIds: [c.id] }));
      return [...list.slice(0, i), ...split, ...list.slice(i + 1)];
    });
  }
  function updateSlot(idx: number, patch: Partial<SlotForm>) {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  const podiumCount = (groupId: string) => new Set((hof?.entries ?? []).filter((e) => e.groupId === groupId).map((e) => e.batchYear)).size;
  const gradeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of classes) if (c.grade && !seen.has(c.gradeId)) seen.set(c.gradeId, c.grade.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [classes]);
  const sectionsOf = (g: HofGroup) =>
    g.sectionIds.length ? classes.filter((c) => g.sectionIds.includes(c.id)) : classes.filter((c) => g.gradeIds.includes(c.gradeId));

  if (!host || hofQuery.isLoading) return <p className="text-sm text-slate-500">Loading the Hall of Fame…</p>;
  if (hofQuery.isError) return <p className="text-sm text-red-600">Could not load the Hall of Fame: {(hofQuery.error as Error).message}</p>;
  if (hof?.unavailable) {
    return (
      <div className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        The Hall of Fame is being upgraded to keep every batch. It will be back once the database update has run — nothing already published is lost.
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Hall of Fame</h2>
        <p className="text-sm text-slate-500 max-w-2xl">
          Every batch keeps its place. Pick a batch year, choose what a podium is for — a website course, a real class, or a group you
          name — then fill the three places. Groups with no podium in a year are simply not shown for that year.
        </p>
      </div>

      {/* ── Batch year ── */}
      <section className="space-y-2">
        <Label>Batch year</Label>
        <div className="flex flex-wrap items-center gap-2">
          {yearChips.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              aria-pressed={y === activeYear}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                y === activeYear ? 'border-[var(--sk-brand)] bg-[var(--sk-brand-tint)] text-[var(--sk-brand)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              {y}
              {y === hof?.currentYear && <span className="ml-1 text-xs font-medium opacity-70">· current</span>}
            </button>
          ))}
          {addingYear ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const y = Number(newYear);
                if (!Number.isInteger(y) || y < 1990 || y > (hof?.currentYear ?? 2100) + 1) {
                  toast.error(`Enter a year between 1990 and ${(hof?.currentYear ?? 2100) + 1}`);
                  return;
                }
                setYear(y);
                setAddingYear(false);
              }}
            >
              <Input
                autoFocus
                type="number"
                inputMode="numeric"
                min={1990}
                max={(hof?.currentYear ?? 2100) + 1}
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className="w-28"
                aria-label="New batch year"
              />
              <Button type="submit" size="sm">Add batch</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAddingYear(false)}>Cancel</Button>
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNewYear(String(yearChips.includes(hof?.currentYear ?? 0) ? (hof?.currentYear ?? 0) + 1 : hof?.currentYear ?? new Date().getFullYear()));
                setAddingYear(true);
              }}
            >
              + New batch…
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-400">A batch is created the moment you save its first podium.</p>
      </section>

      {/* ── Groups ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Label>What each podium is for</Label>
            <p className="text-xs text-slate-400">Order here is the order of the tabs on your website.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={courses.length === 0} onClick={() => addDraft('COURSE')}>+ Website course</Button>
            {hasManagement && (
              <Button type="button" size="sm" variant="outline" disabled={gradeOptions.length === 0} onClick={() => addDraft('GRADES')}>+ Class</Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => addDraft('CUSTOM')}>+ Custom group</Button>
          </div>
        </div>

        {groupDrafts.length === 0 ? (
          <p className="text-sm text-slate-500 rounded-xl border border-dashed border-slate-200 p-4">
            No groups yet. Add a website course, a class{hasManagement ? '' : ' (with the Management module)'}, or a custom group such as “Board toppers”.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {groupDrafts.map((d, idx) => {
              const saved = savedGroups.find((g) => g.id === d.id);
              const podiums = saved ? podiumCount(saved.id) : 0;
              return (
                <li key={d.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                  <div className="flex items-center gap-1 sm:pt-1.5">
                    <button type="button" className="text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move up" disabled={idx === 0} onClick={() => moveDraft(d.key, -1)}>↑</button>
                    <button type="button" className="text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move down" disabled={idx === groupDrafts.length - 1} onClick={() => moveDraft(d.key, 1)}>↓</button>
                  </div>
                  <div className="flex-1 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                    <div>
                      <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{KIND_LABEL[d.kind]}</span>
                      <Input
                        className="mt-1.5"
                        value={d.label}
                        placeholder={autoLabel(d, courses, classes) || (d.kind === 'CUSTOM' ? 'Group name (required)' : 'Name (optional)')}
                        onChange={(e) => updateDraft(d.key, { label: e.target.value })}
                        aria-label="Group name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      {d.kind === 'COURSE' && (
                        <Select value={d.courseId} onChange={(e) => updateDraft(d.key, { courseId: e.target.value })} aria-label="Course">
                          {courses.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                      )}
                      {d.kind === 'GRADES' && d.sectionIds.length === 0 && (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {gradeOptions.map((g) => {
                              const on = d.gradeIds.includes(g.id);
                              return (
                                <button
                                  key={g.id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => updateDraft(d.key, { gradeIds: on ? d.gradeIds.filter((x) => x !== g.id) : [...d.gradeIds, g.id] })}
                                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? 'border-[var(--sk-brand)] bg-[var(--sk-brand-tint)] text-[var(--sk-brand)]' : 'border-slate-200 text-slate-600'}`}
                                >
                                  {g.name}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-xs text-slate-400">
                            Sections are clubbed — one podium for the whole class.
                            {d.gradeIds.length === 1 && classes.filter((c) => c.gradeId === d.gradeIds[0]).length > 1 && (
                              <>
                                {' '}
                                <button type="button" className="font-semibold text-[var(--sk-brand)] hover:underline" onClick={() => splitBySection(d.key)}>
                                  Split by section
                                </button>
                              </>
                            )}
                          </p>
                        </>
                      )}
                      {d.kind === 'GRADES' && d.sectionIds.length > 0 && (
                        <p className="text-xs text-slate-500">
                          One section: <b>{autoLabel(d, courses, classes)}</b>
                        </p>
                      )}
                      {d.kind === 'CUSTOM' && <p className="text-xs text-slate-400">Any group you like — “Board toppers”, “House champions”.</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:pt-1">
                    {saved && podiums > 0 && <span className="text-xs text-slate-400 whitespace-nowrap">{podiums} {podiums === 1 ? 'batch' : 'batches'}</span>}
                    {confirmRemove === d.key ? (
                      <Button type="button" size="sm" variant="destructive" onClick={() => removeDraft(d.key)}>
                        {podiums > 0 ? `Remove & delete ${podiums} ${podiums === 1 ? 'podium' : 'podiums'}` : 'Confirm remove'}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => (podiums > 0 || saved ? setConfirmRemove(d.key) : removeDraft(d.key))}>
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {groupsDirty && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => saveGroups.mutate()} disabled={saveGroups.isPending}>
              {saveGroups.isPending ? 'Saving…' : 'Save groups'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setDrafts(null); setConfirmRemove(null); }}>Discard changes</Button>
            <span className="text-xs text-slate-400">Save the groups before filling podiums.</span>
          </div>
        )}
      </section>

      {/* ── Podium for (group, year) ── */}
      {savedGroups.length > 0 && activeGroup && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[16rem]">
              <Label htmlFor="hof-group">Podium for</Label>
              <Select id="hof-group" value={activeGroup.id} onChange={(e) => setActiveGroupKey(e.target.value)}>
                {savedGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </Select>
            </div>
            <div className="text-sm text-slate-600 pb-2">Batch of <b>{activeYear}</b></div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {slots.map((slot, i) => (
              <HofSlot
                key={`${activeGroup.id}-${activeYear}-${i}`}
                medal={MEDALS[i]}
                placeLabel={PLACES[i]}
                slot={slot}
                existingPhotoUrl={photoUrl(slot.photoAssetId)}
                onChange={(patch) => updateSlot(i, patch)}
                api={api}
                onUploaded={() => void queryClient.invalidateQueries({ queryKey: ['site-media-hof'] })}
                sections={hasManagement && activeGroup.kind === 'GRADES' ? sectionsOf(activeGroup) : hasManagement ? classes : []}
              />
            ))}
          </div>
          <Button type="button" onClick={() => savePodium.mutate()} disabled={savePodium.isPending}>
            {savePodium.isPending ? 'Saving…' : `Save Batch of ${activeYear}`}
          </Button>
        </section>
      )}

      {/* ── What the website opens on ── */}
      <section className="space-y-3 max-w-xl">
        <Label>On the website</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hof-landing" className="text-xs text-slate-500">Open on</Label>
            <Select id="hof-landing" value={landingValue} onChange={(e) => setLanding(e.target.value)}>
              <option value="latest">Latest batch with entries</option>
              {(hof?.years ?? []).map((y) => (
                <option key={y} value={String(y)}>Batch of {y}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hof-past" className="text-xs text-slate-500">Batches to list (1–10)</Label>
            <Input id="hof-past" type="number" inputMode="numeric" min={1} max={10} value={pastValue} onChange={(e) => setPastBatches(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending || (landing === null && pastBatches === null)}>
            {saveSettings.isPending ? 'Saving…' : 'Save settings'}
          </Button>
          <span className="text-xs text-slate-400">The layout (podium, medal wall, spotlight…) is chosen in the Design tab under Per-section layout.</span>
        </div>
      </section>
    </div>
  );
}

function HofSlot({
  medal,
  placeLabel,
  slot,
  existingPhotoUrl,
  onChange,
  api,
  onUploaded,
  sections,
}: {
  medal: string;
  placeLabel: string;
  slot: SlotForm;
  existingPhotoUrl: string | null;
  onChange: (patch: Partial<SlotForm>) => void;
  api: ReturnType<typeof useApi>;
  onUploaded: () => void;
  /** Sections the picker may search (empty = no picker: BASIC/STANDARD, or a group without classes). */
  sections: ClassRow[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sectionId, setSectionId] = useState('');
  const preview = slot.photoPreviewUrl ?? existingPhotoUrl;
  const host = useHost();
  const rosterQuery = useQuery({
    queryKey: ['manage-students', sectionId],
    queryFn: () => api.get<RosterStudent[]>(`/manage/students?classSectionId=${encodeURIComponent(sectionId)}`),
    enabled: !!host && picking && !!sectionId,
  });

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=HOF', { method: 'POST', body: fd });
      onChange({ photoAssetId: asset.id, photoPreviewUrl: asset.url });
      onUploaded();
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">{medal}</span> {placeLabel} place
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={slot.name || placeLabel} className="h-14 w-14 rounded-full object-cover border border-slate-200" loading="lazy" decoding="async" />
          ) : (
            <div className="h-14 w-14 rounded-full bg-slate-100 grid place-items-center text-slate-400 text-lg" aria-hidden="true">🎓</div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />
            {uploading ? 'Uploading…' : 'Photo'}
          </Button>
        </div>
        <Input value={slot.name} onChange={(e) => onChange({ name: e.target.value, studentId: null })} placeholder="Student name" aria-label={`${placeLabel} place name`} />
        <Input value={slot.achievement} onChange={(e) => onChange({ achievement: e.target.value })} placeholder="Achievement (e.g. 98.2%)" aria-label={`${placeLabel} place achievement`} />
        {sections.length > 0 && (
          <div className="space-y-1.5">
            {!picking ? (
              <button type="button" className="text-xs font-semibold text-[var(--sk-brand)] hover:underline" onClick={() => { setPicking(true); setSectionId(sections[0]?.id ?? ''); }}>
                🔍 Pick from students
              </button>
            ) : (
              <>
                <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
                  {sections.map((c) => (
                    <option key={c.id} value={c.id}>{c.grade?.name ? `${c.grade.name}-${c.name}` : c.name}</option>
                  ))}
                </Select>
                <Select
                  value={slot.studentId ?? ''}
                  onChange={(e) => {
                    const st = rosterQuery.data?.find((s) => s.id === e.target.value);
                    if (st) onChange({ studentId: st.id, name: `${st.firstName} ${st.lastName}`.trim() });
                  }}
                  aria-label="Student"
                  disabled={!rosterQuery.data}
                >
                  <option value="">{rosterQuery.isLoading ? 'Loading…' : rosterQuery.data?.length ? 'Choose a student' : 'No students in this section'}</option>
                  {(rosterQuery.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.firstName} {s.lastName}{s.rollNo ? ` · Roll ${s.rollNo}` : ''}</option>
                  ))}
                </Select>
                <button type="button" className="text-xs text-slate-400 hover:underline" onClick={() => setPicking(false)}>Type the name instead</button>
              </>
            )}
          </div>
        )}
        {slot.studentId && <p className="text-xs text-slate-400">Linked to the register — the photo follows the student’s profile if none is uploaded here.</p>}
        <p className="text-xs text-slate-400">Leave the name empty to clear this place.</p>
      </CardContent>
    </Card>
  );
}
