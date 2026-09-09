'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { ApiError } from '@/lib/api';
import { useHost } from '@/components/use-host';
import {
  AUDIENCE_OPTIONS,
  NAME_FORMAT_OPTIONS,
  PAGE_STYLES,
  TEASER_STYLES,
  WINDOW_OPTIONS,
  type CelebrationsConfig,
  type CelebrationsPage,
  type CelebrationsPlacement,
  type CelebrationsTeaser,
  type ManualCelebration,
  type StyleOption,
} from '@/components/public/celebrations-config';

/**
 * Website → Celebrations: the birthday wall's settings (Active Roster, Track B).
 *
 * The left card is the whole config, saved in one PUT so a half-changed wall
 * never goes live. The right card is what the wall would show THIS WEEK from
 * real records, with the per-child switches beside each name — the office
 * hides a child from the wall here, not by hunting through the register.
 * Schools without the Management plan keep a typed list instead.
 *
 * The rules are mirrored from the API (`normalizeCelebrationsConfig` +
 * `CONSENT_REQUIRED`): the tab refuses the same things, in words, before the
 * server has to.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WISH_MAX = 160;
const MANUAL_MAX = 500;

interface PreviewRow {
  studentId: string;
  name: string;
  classLabel: string | null;
  day: number;
  month: number;
  showOnWebsite: boolean;
  photoConsent: boolean;
  hasPhoto: boolean;
}
interface Preview {
  week: PreviewRow[];
  missingDob: number;
  generatedFor: string;
}
interface SiteContent {
  homepage?: { showBirthdays?: boolean } | null;
}
interface Me {
  features?: string[];
}

const PLACEMENT_OPTIONS: StyleOption<CelebrationsPlacement>[] = [
  { value: 'TEASER_AND_PAGE', label: 'Teaser + page', hint: 'A small hint on the homepage that opens the full page.' },
  { value: 'PAGE_ONLY', label: 'Page only', hint: 'Nothing on the homepage. The page sits in the menu under Our school.' },
];
const SOURCE_OPTIONS: StyleOption<CelebrationsConfig['source']>[] = [
  { value: 'STUDENTS', label: 'Active students', hint: 'Every active child with a date of birth on record.' },
  { value: 'MANUAL', label: 'A list I type', hint: 'Names and dates you keep on this page.' },
];

function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') return (err.body as { code?: string }).code;
  return undefined;
}

// ── control primitives (console kit: .sk-chip, .sk-switch, .sk-cel-style) ──
function Chips<T extends string>({
  options, value, onPick, disabledValue,
}: { options: readonly StyleOption<T>[]; value: T; onPick: (v: T) => void; disabledValue?: T }) {
  return (
    <div className="sk-cel-chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="sk-chip sk-press"
          title={o.hint}
          aria-pressed={value === o.value}
          disabled={o.value === disabledValue}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="sk-switch" disabled={disabled} onClick={() => onChange(!checked)} />
  );
}

/** A picker whose options are LOOKS: each card carries a drawn thumbnail. */
function StyleCards<T extends string>({
  options, value, onPick, thumb,
}: { options: readonly StyleOption<T>[]; value: T; onPick: (v: T) => void; thumb: (v: T) => React.ReactNode }) {
  return (
    <div className="sk-cel-styles">
      {options.map((o) => (
        <button key={o.value} type="button" className="sk-cel-style" aria-pressed={value === o.value} onClick={() => onPick(o.value)}>
          {thumb(o.value)}
          <b>{o.label}</b>
          <small>{o.hint}</small>
        </button>
      ))}
    </div>
  );
}

// ── thumbnails: what each look is, in forty pixels ──
function PageThumb({ style }: { style: CelebrationsPage }) {
  if (style === 'MONTH_PLANNER') {
    return (
      <svg className="sk-cel-thumb" viewBox="0 0 140 56" aria-hidden="true">
        <rect width="140" height="56" rx="6" fill="#FFFDF7" />
        {Array.from({ length: 28 }, (_, i) => {
          const x = 8 + (i % 7) * 18;
          const y = 8 + Math.floor(i / 7) * 11;
          const today = i === 9;
          const dot = i === 9 || i === 11 || i === 17 || i === 24;
          return (
            <g key={i}>
              <rect x={x} y={y} width="15" height="9" rx="2" fill="#fff" stroke={today ? '#4F46E5' : '#E5E7EB'} strokeWidth={today ? 1.5 : 1} />
              {dot && <circle cx={x + 11.5} cy={y + 3} r="1.6" fill="#F59E0B" />}
            </g>
          );
        })}
      </svg>
    );
  }
  if (style === 'NOTICE_BOARD') {
    return (
      <svg className="sk-cel-thumb" viewBox="0 0 140 56" aria-hidden="true">
        <rect width="140" height="56" rx="6" fill="#B5814F" />
        <rect x="12" y="10" width="40" height="34" rx="2" fill="#fff" transform="rotate(-4 32 27)" />
        <rect x="58" y="12" width="34" height="32" rx="2" fill="#FFF8DC" transform="rotate(3 75 28)" />
        <rect x="98" y="9" width="30" height="36" rx="2" fill="#fff" transform="rotate(-2 113 27)" />
        <circle cx="32" cy="12" r="2.6" fill="#EF4444" />
        <circle cx="75" cy="14" r="2.6" fill="#2563EB" />
        <circle cx="113" cy="11" r="2.6" fill="#10B981" />
        <circle cx="32" cy="27" r="6" fill="#E5E7EB" />
        <rect x="20" y="36" width="24" height="2" rx="1" fill="#CBD5E1" />
        <rect x="63" y="34" width="24" height="2" rx="1" fill="#CBD5E1" />
        <rect x="103" y="34" width="20" height="2" rx="1" fill="#CBD5E1" />
      </svg>
    );
  }
  return (
    <svg className="sk-cel-thumb" viewBox="0 0 140 56" aria-hidden="true">
      <rect width="140" height="56" rx="6" fill="#FFF7ED" />
      {[
        [12, 8, '#F43F5E'], [30, 4, '#3B82F6'], [55, 10, '#F59E0B'], [82, 5, '#10B981'], [110, 9, '#8B5CF6'], [128, 6, '#F43F5E'], [70, 46, '#3B82F6'], [20, 48, '#10B981'], [120, 47, '#F59E0B'],
      ].map(([x, y, c], i) => (
        <rect key={i} x={x as number} y={y as number} width="5" height="3" rx="1" fill={c as string} transform={`rotate(${(i * 37) % 90} ${(x as number) + 2} ${(y as number) + 1})`} />
      ))}
      <circle cx="40" cy="30" r="13" fill="#fff" stroke="#F59E0B" strokeWidth="2.5" />
      <circle cx="70" cy="30" r="11" fill="#E0E7FF" />
      <circle cx="98" cy="30" r="11" fill="#FCE7F3" />
    </svg>
  );
}

function TeaserThumb({ style }: { style: CelebrationsTeaser }) {
  return (
    <svg className="sk-cel-thumb" viewBox="0 0 140 56" aria-hidden="true">
      <rect width="140" height="56" rx="6" fill="#F8FAFC" />
      <rect x="0" y="0" width="140" height="12" fill="#fff" />
      <rect x="8" y="4" width="22" height="4" rx="2" fill="#4F46E5" />
      <rect x="80" y="4" width="14" height="4" rx="2" fill="#CBD5E1" />
      <rect x="98" y="4" width="14" height="4" rx="2" fill="#CBD5E1" />
      <rect x="116" y="4" width="14" height="4" rx="2" fill="#CBD5E1" />
      {style === 'RIBBON' ? (
        <>
          <rect x="0" y="12" width="140" height="9" fill="#F59E0B" />
          <rect x="8" y="15" width="30" height="3" rx="1.5" fill="#fff" />
          <rect x="44" y="15" width="22" height="3" rx="1.5" fill="#fff" opacity="0.8" />
          <rect x="72" y="15" width="26" height="3" rx="1.5" fill="#fff" opacity="0.8" />
          <rect x="8" y="30" width="70" height="6" rx="2" fill="#E2E8F0" />
          <rect x="8" y="40" width="50" height="4" rx="2" fill="#E2E8F0" />
        </>
      ) : (
        <>
          <rect x="8" y="24" width="70" height="6" rx="2" fill="#E2E8F0" />
          <rect x="8" y="34" width="50" height="4" rx="2" fill="#E2E8F0" />
          <rect x="86" y="38" width="46" height="12" rx="6" fill="#fff" stroke="#E5E7EB" />
          <rect x="92" y="42" width="5" height="4" rx="1" fill="#FB7185" />
          <rect x="94" y="39" width="1.2" height="3" fill="#F59E0B" />
          <rect x="101" y="42" width="24" height="3" rx="1.5" fill="#94A3B8" />
        </>
      )}
    </svg>
  );
}

/** The wish line with its first placeholder filled and the school's shown as a token, not a guess. */
function WishExample({ line }: { line: string }) {
  const parts = line.replace('{first name}', 'Aarav').split('{school}');
  return (
    <p className="sk-cel-example">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <i>school name</i>}
        </span>
      ))}
    </p>
  );
}

// ── the tab ──
export default function CelebrationsTab({ onGoToHomepage }: { onGoToHomepage: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();

  const cfgQuery = useQuery<CelebrationsConfig>({
    queryKey: ['site-celebrations', host],
    queryFn: () => api.get('/site/celebrations'),
    enabled: !!host,
  });
  const previewQuery = useQuery<Preview>({
    queryKey: ['site-celebrations-preview', host],
    queryFn: () => api.get('/site/celebrations/preview'),
    enabled: !!host,
  });
  const contentQuery = useQuery<SiteContent>({
    queryKey: ['site-content'],
    queryFn: () => api.get('/site/content'),
    enabled: !!host,
  });
  const meQuery = useQuery<Me>({
    queryKey: ['me', host],
    queryFn: () => api.get('/auth/me'),
    enabled: !!host,
    staleTime: 5 * 60_000,
  });

  const [draft, setDraft] = useState<CelebrationsConfig | null>(null);
  const saved = cfgQuery.data;
  const config = draft ?? saved;
  const dirty = draft !== null;

  const save = useMutation({
    mutationFn: (next: CelebrationsConfig) => api.put<CelebrationsConfig>('/site/celebrations', next),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['site-celebrations', host] });
      void queryClient.invalidateQueries({ queryKey: ['site-celebrations-preview', host] });
      toast.success('Saved — the website picks it up within a minute');
    },
    onError: (err: Error) => {
      toast.error(errorCode(err) === 'CONSENT_REQUIRED' ? err.message : `Could not save: ${err.message}`);
    },
  });

  const flip = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { showOnWebsite?: boolean; photoConsent?: boolean } }) =>
      api.put(`/manage/students/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['site-celebrations-preview', host] }),
    onError: (err: Error) => toast.error(`Could not update the student: ${err.message}`),
  });

  if (cfgQuery.isError) {
    return <p className="text-sm text-rose-600">Could not load the celebrations settings: {(cfgQuery.error as Error).message}</p>;
  }
  if (!config) return <p className="sk-muted">Loading…</p>;

  const set = (patch: Partial<CelebrationsConfig>) => setDraft({ ...config, ...patch });

  // A school without the Management plan has no records to pull from; its wall
  // is the typed list whatever the stored source says (D5). Unknown until
  // /auth/me answers — until then trust the config, so nothing flickers.
  const managementKnown = !!meQuery.data;
  const hasManagement = (meQuery.data?.features ?? []).includes('MANAGEMENT');
  const source: CelebrationsConfig['source'] = managementKnown && !hasManagement ? 'MANUAL' : config.source;

  const wantsPublic = config.audience !== 'FAMILIES';
  const showBirthdays = contentQuery.data?.homepage?.showBirthdays;

  const problems: string[] = [];
  if (wantsPublic && !config.consentConfirmed) problems.push('Tick the consent box before birthdays can go on the public website.');
  if (config.wishLine.length > WISH_MAX) problems.push(`The wish line is ${config.wishLine.length - WISH_MAX} characters too long.`);
  if (source === 'MANUAL' && config.manual.some((m) => !m.name.trim() || m.day < 1 || m.day > 31 || m.month < 1 || m.month > 12)) {
    problems.push('Every name on your list needs a name, a day and a month.');
  }

  const preview = previewQuery.data;

  return (
    <div className="sk-cel-grid">
      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Birthdays on the website</h3>
          <span className="sk-sub">Who appears, who can see it, and how it looks.</span>
        </div>
        <div className="sk-card-b">
          {showBirthdays === false && (
            <div className="sk-notice" role="status">
              <p className="nt">The Birthdays section is switched off</p>
              <p className="nd">Nothing is published until it is ticked under “Sections on the homepage”. Your settings here are kept either way.</p>
              <button type="button" className="sk-btn sk-press" style={{ marginTop: 8 }} onClick={onGoToHomepage}>
                Turn it on in Homepage
              </button>
            </div>
          )}
          {showBirthdays && wantsPublic && (
            <p className="sk-cel-hint">
              Live at{' '}
              <a href={`https://${host}/birthdays`} target="_blank" rel="noreferrer">
                {host}/birthdays <ExternalLink className="inline h-3 w-3" aria-hidden="true" />
              </a>
              . Changes show within a minute of saving.
            </p>
          )}
          {showBirthdays && !wantsPublic && (
            <p className="sk-cel-hint">Families see it in the portal and the app after signing in. Nothing goes on the public website.</p>
          )}

          <section className="sk-cel-sec">
            <span className="sk-lab">Who can see it</span>
            <StyleCards options={AUDIENCE_OPTIONS} value={config.audience} onPick={(v) => set({ audience: v })} thumb={() => null} />
            {wantsPublic && (
              <label className="sk-cel-consent">
                <input
                  type="checkbox"
                  checked={config.consentConfirmed}
                  onChange={(e) => set({ consentConfirmed: e.target.checked })}
                />
                <span>
                  Our school holds parental consent for this
                  <small>Children’s names and classes go on a page anyone can open. Tick this only if your admission form covers it.</small>
                </span>
              </label>
            )}
          </section>

          <section className="sk-cel-sec">
            <span className="sk-lab">Who is on the wall</span>
            <Chips
              options={SOURCE_OPTIONS}
              value={source}
              onPick={(v) => set({ source: v })}
              disabledValue={managementKnown && !hasManagement ? 'STUDENTS' : undefined}
            />
            <p className="sk-cel-hint">
              {managementKnown && !hasManagement
                ? 'Pulling from student records needs the Management plan. Until then, keep the list on the right.'
                : source === 'STUDENTS'
                  ? 'Only active students with a date of birth. Hide any child with the switch on the right.'
                  : 'Names and dates you type on the right. Nothing is read from the register.'}
            </p>
          </section>

          <section className="sk-cel-sec">
            <span className="sk-lab">How far ahead</span>
            <Chips options={WINDOW_OPTIONS} value={config.window} onPick={(v) => set({ window: v })} />
          </section>

          <section className="sk-cel-sec">
            <span className="sk-lab">Names</span>
            <Chips options={NAME_FORMAT_OPTIONS} value={config.nameFormat} onPick={(v) => set({ nameFormat: v })} />
            <p className="sk-cel-hint">{NAME_FORMAT_OPTIONS.find((o) => o.value === config.nameFormat)?.hint}</p>
            <div className="sk-cel-switchrow">
              <span>Class beside the name</span>
              <Switch checked={config.showClass} label="Show the class beside the name" onChange={(v) => set({ showClass: v })} />
            </div>
            <div className="sk-cel-switchrow">
              <span>
                Photos
                <small>Only children whose parents gave photo consent. Everyone else gets an initials coin.</small>
              </span>
              <Switch checked={config.showPhotos} label="Show photos of children with consent" onChange={(v) => set({ showPhotos: v })} />
            </div>
          </section>

          <section className="sk-cel-sec">
            <span className="sk-lab">On the homepage</span>
            <Chips options={PLACEMENT_OPTIONS} value={config.placement} onPick={(v) => set({ placement: v })} />
            {config.placement === 'TEASER_AND_PAGE' && (
              <StyleCards options={TEASER_STYLES} value={config.teaser} onPick={(v) => set({ teaser: v })} thumb={(v) => <TeaserThumb style={v} />} />
            )}
          </section>

          <section className="sk-cel-sec">
            <span className="sk-lab">The page</span>
            <StyleCards options={PAGE_STYLES} value={config.page} onPick={(v) => set({ page: v })} thumb={(v) => <PageThumb style={v} />} />
          </section>

          <section className="sk-cel-sec">
            <label className="sk-lab" htmlFor="cel-wish">Wish line</label>
            <input
              id="cel-wish"
              className="sk-input"
              value={config.wishLine}
              maxLength={WISH_MAX + 20}
              onChange={(e) => set({ wishLine: e.target.value })}
              placeholder="Happy birthday, {first name}! From all of us at {school}."
            />
            <p className="sk-cel-hint">
              {'{first name}'} and {'{school}'} are filled in for each child · {config.wishLine.length}/{WISH_MAX}
            </p>
            <WishExample line={config.wishLine} />
          </section>

          {problems.length > 0 && (
            <div role="alert" className="sk-notice">
              <p className="nt">Not ready to save yet</p>
              {problems.map((p) => (
                <p key={p} className="nd">{p}</p>
              ))}
            </div>
          )}

          <div className="sk-cel-actions">
            <button
              type="button"
              className="sk-btn sk-press"
              data-variant="primary"
              disabled={!dirty || problems.length > 0 || save.isPending}
              onClick={() => save.mutate({ ...config, source })}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="sk-btn sk-press" disabled={!dirty || save.isPending} onClick={() => setDraft(null)}>
              Discard changes
            </button>
          </div>
        </div>
      </div>

      {source === 'STUDENTS' ? (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>This week on the site</h3>
            <span className="sk-sub">Active students with a birthday in the next seven days</span>
          </div>
          <div className="sk-card-b">
            {previewQuery.isLoading && <p className="sk-muted">Loading…</p>}
            {previewQuery.isError && <p className="text-sm text-rose-600">Could not load this week’s list.</p>}
            {preview && preview.week.length === 0 && (
              <p className="sk-muted">No birthdays in the next seven days. The page still shows whose birthday comes next.</p>
            )}
            {preview && preview.week.length > 0 && (
              <div>
                {preview.week.map((r) => (
                  <div className="sk-cel-row" key={r.studentId}>
                    <div className="sk-cel-date">
                      <b>{r.day}</b>
                      <small>{MONTHS[r.month - 1]}</small>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="nm">{r.name}</div>
                      <div className="meta">
                        {r.classLabel ?? 'No class'}
                        {r.hasPhoto ? '' : ' · no photo on file'}
                      </div>
                    </div>
                    <div className="sk-cel-toggles">
                      <div className="sk-cel-toggle">
                        <span>Photo</span>
                        <Switch
                          checked={r.photoConsent}
                          label={`Allow ${r.name}'s photo on the wall`}
                          disabled={flip.isPending}
                          onChange={(v) => flip.mutate({ id: r.studentId, patch: { photoConsent: v } })}
                        />
                      </div>
                      <div className="sk-cel-toggle">
                        <span>On the wall</span>
                        <Switch
                          checked={r.showOnWebsite}
                          label={`Show ${r.name} on the wall`}
                          disabled={flip.isPending}
                          onChange={(v) => flip.mutate({ id: r.studentId, patch: { showOnWebsite: v } })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {preview && preview.missingDob > 0 && (
              <div className="sk-notice">
                <p className="nt">
                  {preview.missingDob} active {preview.missingDob === 1 ? 'student has' : 'students have'} no date of birth
                </p>
                <p className="nd">
                  They will never appear on the wall. Add it from <Link href="/app/students" className="underline">Students</Link> → Edit.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ManualList rows={config.manual} onChange={(manual) => set({ manual })} />
      )}
    </div>
  );
}

/** The typed list: name, day, month, class. No year — it is never shown, so it is never asked. */
function ManualList({ rows, onChange }: { rows: ManualCelebration[]; onChange: (rows: ManualCelebration[]) => void }) {
  const edit = (i: number, patch: Partial<ManualCelebration>) => onChange(rows.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  const add = () => {
    const now = new Date();
    onChange([...rows, { name: '', day: now.getDate(), month: now.getMonth() + 1, classLabel: null }]);
  };
  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>Your list</h3>
        <span className="sk-sub">
          {rows.length} of {MANUAL_MAX}
        </span>
      </div>
      <div className="sk-card-b">
        <p className="sk-cel-hint">Name, day and month. The class is optional. Saved with the Save button on the left.</p>
        {rows.length === 0 && <p className="sk-muted">Nobody yet — add the first name below.</p>}
        <div>
          {rows.map((r, i) => (
            <div className="sk-cel-mrow" key={i}>
              <input className="sk-input name" aria-label={`Name ${i + 1}`} value={r.name} placeholder="Aarav M." onChange={(e) => edit(i, { name: e.target.value })} />
              <input
                className="sk-input day"
                type="number"
                min={1}
                max={31}
                aria-label={`Day ${i + 1}`}
                value={r.day || ''}
                onChange={(e) => edit(i, { day: Number(e.target.value) })}
              />
              <select className="sk-input month" aria-label={`Month ${i + 1}`} value={r.month} onChange={(e) => edit(i, { month: Number(e.target.value) })}>
                {MONTHS.map((m, mi) => (
                  <option key={m} value={mi + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <input className="sk-input cls" aria-label={`Class ${i + 1}`} value={r.classLabel ?? ''} placeholder="Class" onChange={(e) => edit(i, { classLabel: e.target.value || null })} />
              <button type="button" className="sk-btn sk-press" data-icon aria-label={`Remove ${r.name || `row ${i + 1}`}`} onClick={() => onChange(rows.filter((_, ri) => ri !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="sk-btn sk-press" disabled={rows.length >= MANUAL_MAX} onClick={add}>
            <Plus className="h-4 w-4" /> Add a name
          </button>
        </div>
      </div>
    </div>
  );
}
