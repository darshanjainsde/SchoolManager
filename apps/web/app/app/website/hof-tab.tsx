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

/* ── Contracts (apps/api/src/modules/cms/internal/hall-of-fame.*) ─────────── */
type GroupKind = 'COURSE' | 'GRADES' | 'CUSTOM';
/** A "class" on this screen. The API still knows the kind a row was made with;
 *  the admin only ever sees and edits the name. New rows are CUSTOM. */
interface HofClass {
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
  displayName: string;
  photoUrl: string | null;
}
interface HofOverview {
  groups: HofClass[];
  entries: HofEntry[];
  years: number[];
  currentYear: number;
  settings: { landingYear: number | null; pastBatches: number };
  unavailable: boolean;
}
/** /manage/students (SCHOOL_ADMIN → the full projection). */
interface StudentRow {
  id: string;
  firstName: string;
  lastName: string;
  admissionNo?: string | null;
  rollNo?: string | null;
  photoAssetId?: string | null;
  classSection?: { name: string; grade?: { name: string } | null } | null;
}
interface MediaAsset {
  id: string;
  url: string;
}
interface SiteContent {
  school?: { features?: string[] } | null;
}

interface SlotForm {
  name: string;
  achievement: string;
  photoAssetId: string | null;
  photoPreviewUrl: string | null;
  studentId: string | null;
  /** What the site shows today for this place (from the overview) — the linked profile wins. */
  currentPhotoUrl: string | null;
  currentName: string;
}
const EMPTY_SLOT: SlotForm = { name: '', achievement: '', photoAssetId: null, photoPreviewUrl: null, studentId: null, currentPhotoUrl: null, currentName: '' };
const MEDALS = ['🥇', '🥈', '🥉'];
const PLACES = ['First', 'Second', 'Third'];

const classLabel = (s: StudentRow) =>
  s.classSection ? [s.classSection.grade?.name, s.classSection.name].filter(Boolean).join('-') : '';
const fullName = (s: StudentRow) => `${s.firstName} ${s.lastName}`.trim();

export default function HallOfFameTab() {
  // Every tenant-scoped query waits for the host (host-guard.test.ts) and the
  // client carries it as the tenant header (tenant-host.test.ts).
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const hofQuery = useQuery({ queryKey: ['site-hof'], queryFn: () => api.get<HofOverview>('/site/hall-of-fame'), enabled: !!host });
  const contentQuery = useQuery({ queryKey: ['site-content'], queryFn: () => api.get<SiteContent>('/site/content'), enabled: !!host });
  const hasManagement = (contentQuery.data?.school?.features ?? []).includes('MANAGEMENT');
  const studentsQuery = useQuery({
    queryKey: ['manage-students-all'],
    queryFn: () => api.get<StudentRow[]>('/manage/students'),
    enabled: !!host && hasManagement,
  });
  const avatarsQuery = useQuery({
    queryKey: ['site-media-avatar'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=AVATAR'),
    enabled: !!host && hasManagement,
  });

  const hof = hofQuery.data;
  const classes = hof?.groups ?? [];
  const students = studentsQuery.data ?? [];
  const avatarUrl = (id?: string | null) => (id ? (avatarsQuery.data?.find((a) => a.id === id)?.url ?? null) : null);

  // ── Batch year ──
  const [year, setYear] = useState<number | null>(null);
  const [newYear, setNewYear] = useState('');
  const [addingYear, setAddingYear] = useState(false);
  const activeYear = year ?? hof?.years[0] ?? hof?.currentYear ?? new Date().getFullYear();
  const yearChips = useMemo(() => {
    const ys = new Set<number>(hof?.years ?? []);
    if (year != null) ys.add(year);
    return [...ys].sort((a, b) => b - a);
  }, [hof?.years, year]);

  // ── Classes ──
  const [newClass, setNewClass] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const activeClass = classes.find((c) => c.id === activeClassId) ?? classes[0];
  const batchesOf = (id: string) => new Set((hof?.entries ?? []).filter((e) => e.groupId === id).map((e) => e.batchYear)).size;

  // ── Podium slots for (activeClass, activeYear) ──
  const [slots, setSlots] = useState<SlotForm[]>([EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT]);
  useEffect(() => {
    const entries = (hof?.entries ?? []).filter((e) => e.groupId === activeClass?.id && e.batchYear === activeYear);
    setSlots(
      [1, 2, 3].map((rank) => {
        const e = entries.find((x) => x.rank === rank);
        return e
          ? { name: e.name, achievement: e.achievement ?? '', photoAssetId: e.photoAssetId, photoPreviewUrl: null, studentId: e.studentId, currentPhotoUrl: e.photoUrl, currentName: e.displayName }
          : EMPTY_SLOT;
      }),
    );
  }, [hof?.entries, activeClass?.id, activeYear]);

  // ── Settings ──
  const [landing, setLanding] = useState<string | null>(null);
  const [pastBatches, setPastBatches] = useState<string | null>(null);
  const landingValue = landing ?? (hof?.settings.landingYear == null ? 'latest' : String(hof.settings.landingYear));
  const pastValue = pastBatches ?? String(hof?.settings.pastBatches ?? 4);

  const fail = (what: string) => (err: Error) => toast.error(`${what} failed: ${err.message}`);
  const applyOverview = (data: HofOverview) => queryClient.setQueryData(['site-hof'], data);

  /** The whole ordered list goes up each time; the API keeps ids it knows and drops the rest. */
  const putClasses = useMutation({
    mutationFn: (list: HofClass[]) =>
      api.put<HofOverview>('/site/hall-of-fame/groups', {
        groups: list.map((c) => ({
          ...(c.id.startsWith('new:') ? {} : { id: c.id }),
          kind: c.kind,
          label: c.label.trim() || undefined,
          ...(c.kind === 'COURSE' ? { courseId: c.courseId } : {}),
          ...(c.kind === 'GRADES' ? { gradeIds: c.gradeIds, sectionIds: c.sectionIds } : {}),
        })),
      }),
    onSuccess: (data) => {
      applyOverview(data);
      setRenaming(null);
      setConfirmRemove(null);
      setNewClass('');
    },
    onError: fail('Saving classes'),
  });
  const addClass = (label: string) => {
    const name = label.trim();
    if (!name) return;
    if (classes.some((c) => c.label.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(`“${name}” already exists — pick it below to add this batch's toppers.`);
      return;
    }
    putClasses.mutate([...classes, { id: `new:${Date.now()}`, kind: 'CUSTOM', label: name, order: classes.length, courseId: null, gradeIds: [], sectionIds: [] }]);
  };
  const renameClass = (id: string, label: string) => {
    if (!label.trim()) return;
    putClasses.mutate(classes.map((c) => (c.id === id ? { ...c, label } : c)));
  };
  const removeClass = (id: string) => putClasses.mutate(classes.filter((c) => c.id !== id));
  const moveClass = (id: string, dir: -1 | 1) => {
    const list = [...classes];
    const i = list.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    putClasses.mutate(list);
  };

  const savePodium = useMutation({
    mutationFn: () => {
      if (!activeClass) throw new Error('Add a class first');
      return api.put<HofOverview>(`/site/hall-of-fame/groups/${activeClass.id}/${activeYear}`, {
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
      applyOverview(data);
      toast.success(`Batch of ${activeYear} saved`);
    },
    onError: fail('Saving the toppers'),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api.put<HofOverview>('/site/hall-of-fame/settings', {
        landingYear: landingValue === 'latest' ? null : Number(landingValue),
        pastBatches: Math.min(10, Math.max(1, Number(pastValue) || 4)),
      }),
    onSuccess: (data) => {
      applyOverview(data);
      setLanding(null);
      setPastBatches(null);
      toast.success('Settings saved');
    },
    onError: fail('Saving settings'),
  });

  function updateSlot(idx: number, patch: Partial<SlotForm>) {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  if (!host || hofQuery.isLoading) return <p className="text-sm text-slate-500">Loading the Hall of Fame…</p>;
  if (hofQuery.isError) return <p className="text-sm text-red-600">Could not load the Hall of Fame: {(hofQuery.error as Error).message}</p>;
  if (hof?.unavailable) {
    return (
      <div className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        The Hall of Fame is being upgraded to keep every batch. It will be back once the database update has run — nothing already published is lost.
      </div>
    );
  }

  const chipCls = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm font-semibold transition ${on ? 'border-[var(--sk-brand)] bg-[var(--sk-brand-tint)] text-[var(--sk-brand)]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`;

  return (
    <div className="space-y-8 w-full max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Hall of Fame</h2>
        <p className="text-sm text-slate-500 max-w-2xl">
          Pick a batch year, add a class by name, and fill its three places. Every batch keeps its place on the website; a class you
          created for an earlier year is ready for the next one.
        </p>
      </div>

      {/* ── 1 · Batch year ── */}
      <section className="space-y-2">
        <Label>Batch year</Label>
        <div className="flex flex-wrap items-center gap-2">
          {yearChips.map((y) => (
            <button key={y} type="button" onClick={() => setYear(y)} aria-pressed={y === activeYear} className={chipCls(y === activeYear)}>
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
                const max = (hof?.currentYear ?? 2100) + 1;
                if (!Number.isInteger(y) || y < 1990 || y > max) {
                  toast.error(`Enter a year between 1990 and ${max}`);
                  return;
                }
                setYear(y);
                setAddingYear(false);
              }}
            >
              <Input autoFocus type="number" inputMode="numeric" min={1990} max={(hof?.currentYear ?? 2100) + 1} value={newYear} onChange={(e) => setNewYear(e.target.value)} className="w-28" aria-label="New batch year" />
              <Button type="submit" size="sm">Add batch</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAddingYear(false)}>Cancel</Button>
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const cur = hof?.currentYear ?? new Date().getFullYear();
                setNewYear(String(yearChips.includes(cur) ? cur + 1 : cur));
                setAddingYear(true);
              }}
            >
              + New batch…
            </Button>
          )}
        </div>
      </section>

      {/* ── 2 · Classes ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Label>Classes</Label>
            <p className="text-xs text-slate-400">Shown as tabs on the website, in this order.</p>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addClass(newClass);
            }}
          >
            <Input value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="Class name, e.g. Class 10" className="w-56" aria-label="New class name" />
            <Button type="submit" size="sm" disabled={!newClass.trim() || putClasses.isPending}>Add class</Button>
          </form>
        </div>

        {classes.length === 0 ? (
          <p className="text-sm text-slate-500 rounded-xl border border-dashed border-slate-200 p-4">No classes yet — add one above, then fill its toppers for this batch.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {classes.map((c, idx) => {
              const n = batchesOf(c.id);
              const isRenaming = renaming?.id === c.id;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-active={c.id === activeClass?.id}>
                  <div className="flex items-center gap-1">
                    <button type="button" className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label={`Move ${c.label} up`} disabled={idx === 0 || putClasses.isPending} onClick={() => moveClass(c.id, -1)}>↑</button>
                    <button type="button" className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label={`Move ${c.label} down`} disabled={idx === classes.length - 1 || putClasses.isPending} onClick={() => moveClass(c.id, 1)}>↓</button>
                  </div>
                  {isRenaming ? (
                    <form
                      className="flex flex-1 items-center gap-2 min-w-[14rem]"
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameClass(c.id, renaming.label);
                      }}
                    >
                      <Input autoFocus value={renaming.label} onChange={(e) => setRenaming({ id: c.id, label: e.target.value })} aria-label="Class name" />
                      <Button type="submit" size="sm" disabled={putClasses.isPending}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <button type="button" className="flex-1 text-left font-semibold text-slate-800 hover:text-[var(--sk-brand)] min-w-[10rem]" onClick={() => setActiveClassId(c.id)}>
                      {c.label}
                    </button>
                  )}
                  <span className="text-xs text-slate-400 whitespace-nowrap">{n === 0 ? 'no batches yet' : `${n} ${n === 1 ? 'batch' : 'batches'}`}</span>
                  {!isRenaming && (
                    <div className="flex items-center gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming({ id: c.id, label: c.label })}>Rename</Button>
                      {confirmRemove === c.id ? (
                        <Button type="button" size="sm" variant="destructive" disabled={putClasses.isPending} onClick={() => removeClass(c.id)}>
                          {n > 0 ? `Delete ${n} ${n === 1 ? 'batch' : 'batches'}` : 'Confirm'}
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(c.id)}>Remove</Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 3 · Toppers for (class, year) ── */}
      {activeClass && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[14rem]">
              <Label htmlFor="hof-class">Toppers of</Label>
              <Select id="hof-class" value={activeClass.id} onChange={(e) => setActiveClassId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
            </div>
            <div className="pb-2 text-sm text-slate-600">
              Batch of <b>{activeYear}</b>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {slots.map((slot, i) => (
              <HofSlot
                key={`${activeClass.id}-${activeYear}-${i}`}
                medal={MEDALS[i]}
                place={PLACES[i]}
                slot={slot}
                onChange={(patch) => updateSlot(i, patch)}
                api={api}
                students={hasManagement ? students : []}
                studentsLoading={hasManagement && studentsQuery.isLoading}
                avatarUrl={avatarUrl}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => savePodium.mutate()} disabled={savePodium.isPending}>
              {savePodium.isPending ? 'Saving…' : `Save Batch of ${activeYear}`}
            </Button>
            {hasManagement && <span className="text-xs text-slate-400">A linked student's name and photo follow their profile — what they set in the app is what the website shows.</span>}
          </div>
        </section>
      )}

      {/* ── 4 · On the website ── */}
      <section className="space-y-3 max-w-xl">
        <Label>On the website</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="hof-landing" className="text-xs text-slate-500">Open on</Label>
            <Select id="hof-landing" value={landingValue} onChange={(e) => setLanding(e.target.value)}>
              <option value="latest">Latest batch with toppers</option>
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
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending || (landing === null && pastBatches === null)}>
            {saveSettings.isPending ? 'Saving…' : 'Save settings'}
          </Button>
          <span className="text-xs text-slate-400">The look (podium, medal wall, spotlight…) is picked in the Design tab under Per-section layout.</span>
        </div>
      </section>
    </div>
  );
}

function HofSlot({
  medal,
  place,
  slot,
  onChange,
  api,
  students,
  studentsLoading,
  avatarUrl,
}: {
  medal: string;
  place: string;
  slot: SlotForm;
  onChange: (patch: Partial<SlotForm>) => void;
  api: ReturnType<typeof useApi>;
  /** Empty when the school has no register (no Management module). */
  students: StudentRow[];
  studentsLoading: boolean;
  avatarUrl: (id?: string | null) => string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [q, setQ] = useState('');
  const linked = slot.studentId ? students.find((s) => s.id === slot.studentId) : undefined;
  const preview = slot.photoPreviewUrl ?? (slot.photoAssetId ? slot.currentPhotoUrl : null) ?? (linked ? avatarUrl(linked.photoAssetId) : null) ?? slot.currentPhotoUrl;
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return students
      .filter((s) => `${fullName(s)} ${s.admissionNo ?? ''} ${classLabel(s)}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [q, students]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=HOF', { method: 'POST', body: fd });
      onChange({ photoAssetId: asset.id, photoPreviewUrl: asset.url });
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  const shownName = slot.studentId ? (linked ? fullName(linked) : slot.currentName || slot.name) : slot.name;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">{medal}</span> {place} place
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={shownName || place} className="h-14 w-14 rounded-full object-cover border border-slate-200" loading="lazy" decoding="async" />
          ) : (
            <div className="h-14 w-14 rounded-full bg-slate-100 grid place-items-center text-slate-400 text-lg" aria-hidden="true">🎓</div>
          )}
          <div className="min-w-0 flex-1">
            {slot.studentId ? (
              <>
                <div className="truncate text-sm font-semibold text-slate-800">{shownName || 'Linked student'}</div>
                <div className="text-xs text-slate-500">
                  {linked ? classLabel(linked) || 'From the register' : 'From the register'} ·{' '}
                  <button type="button" className="font-semibold text-[var(--sk-brand)] hover:underline" onClick={() => onChange({ studentId: null, name: shownName })}>
                    Unlink
                  </button>
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-400">No student linked — the name below is shown as typed.</div>
            )}
          </div>
        </div>

        {students.length > 0 && !slot.studentId && (
          <div className="space-y-1.5">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students by name, class or admission no." aria-label={`${place} place — search students`} />
            {q.trim() && (
              <ul className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white text-sm">
                {matches.length === 0 && <li className="px-3 py-2 text-slate-400">No match</li>}
                {matches.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => {
                        onChange({ studentId: s.id, name: fullName(s), photoAssetId: null, photoPreviewUrl: null });
                        setQ('');
                      }}
                    >
                      {avatarUrl(s.photoAssetId) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl(s.photoAssetId) ?? ''} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <span className="h-6 w-6 rounded-full bg-slate-100 grid place-items-center text-[10px] text-slate-500" aria-hidden="true">🎓</span>
                      )}
                      <span className="font-medium text-slate-800">{fullName(s)}</span>
                      <span className="ml-auto text-xs text-slate-400">{[classLabel(s), s.rollNo ? `Roll ${s.rollNo}` : null].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {studentsLoading && <p className="text-xs text-slate-400">Loading the student list…</p>}

        {!slot.studentId && (
          <Input value={slot.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Student name" aria-label={`${place} place name`} />
        )}
        <Input value={slot.achievement} onChange={(e) => onChange({ achievement: e.target.value })} placeholder="Achievement (e.g. 98.2%)" aria-label={`${place} place achievement`} />

        <div className="flex items-center gap-2">
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
            {uploading ? 'Uploading…' : slot.studentId ? 'Use a different photo' : 'Photo'}
          </Button>
          {slot.photoAssetId && (
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => onChange({ photoAssetId: null, photoPreviewUrl: null })}>
              {slot.studentId ? 'Back to profile photo' : 'Remove photo'}
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400">Leave the name empty to clear this place.</p>
      </CardContent>
    </Card>
  );
}
