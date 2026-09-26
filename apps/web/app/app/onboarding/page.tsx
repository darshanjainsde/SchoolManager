'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { saveBlob } from '@/lib/save-blob';
import { fmtDay } from '@/lib/fees';
import { HubKpi, HubKpis, HubList, HubPage } from '@/components/ui/hub';
import { Cell, Row, RowTitle } from '@/components/ui/kit';

/**
 * ONBOARDING — the things that take a new school days, done from a sheet.
 *
 * A hub (components/ui/hub.tsx): the numbers say what the school has on
 * file today, the three sheets sit in the order a school needs them with a
 * tick once that kind of data exists, and the import log answers "did that
 * file go in?" without opening Students to count.
 *
 * Nothing on this page updates or deletes: import is additive, and the
 * preview shows every problem before a row is written.
 */
type Kind = 'teachers' | 'students' | 'classes';
const KINDS: { kind: Kind; title: string; what: string; needsSession: boolean }[] = [
  { kind: 'classes', title: 'Classes & sections', what: 'The classes you run and their sections, for one session. Do this first — students are placed into these.', needsSession: true },
  { kind: 'teachers', title: 'Teachers', what: 'Names, contact, post, qualifications, TET, safety checks. Only the names are required.', needsSession: false },
  { kind: 'students', title: 'Students', what: 'The roll for one session: admission number, names, class and section, guardian. New session? Export last year, edit, import here.', needsSession: true },
];
const KIND_LABEL: Record<Kind, string> = { classes: 'Classes & sections', teachers: 'Teachers', students: 'Students' };

interface Issue { row: number; column: string; message: string }
interface Preview { kind: Kind; total: number; ok: number; issues: Issue[]; sample: Record<string, unknown>[]; skipped?: number }
interface ImportResult { created: number; skipped: number; failed: Issue[] }
interface SessionYear { id: string; name: string; isCurrent: boolean }
interface ImportLogRow { id: string; kind: Kind; fileName: string; rows: number; created: number; skipped: number; failed: number; createdAt: string }
interface OnboardingStatus {
  year: { id: string; name: string } | null;
  grades: number; sections: number; teachers: number; students: number;
  imports: ImportLogRow[];
}

export default function OnboardingPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions', host],
    queryFn: () => api.get<{ years?: SessionYear[] }>('/manage/sessions'),
    staleTime: 60_000, refetchOnWindowFocus: false, enabled: !!host,
  });
  const status = useQuery({
    queryKey: ['onboarding-status', host],
    queryFn: () => api.get<OnboardingStatus>('/manage/onboarding/status'),
    refetchOnWindowFocus: false, enabled: !!host,
  });
  const years = sessions.data?.years ?? [];
  const current = years.find((y) => y.isCurrent) ?? null;
  const st = status.data;
  const imports = st?.imports ?? [];
  const last = imports[0] ?? null;

  const exportAll = useMutation({
    mutationFn: async () => {
      const { blob, filename } = await api.download('/manage/onboarding/export/all');
      saveBlob(blob, filename ?? 'sckools-school.xlsx');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const have: Record<Kind, number> = { classes: st?.sections ?? 0, teachers: st?.teachers ?? 0, students: st?.students ?? 0 };

  return (
    <HubPage
      title="Onboarding"
      subtitle="Set a school up from spreadsheets: download a template, fill it in Excel, check it, import. Export the same sheets any time."
      action={
        <button className="sk-btn sk-press" disabled={exportAll.isPending} onClick={() => exportAll.mutate()}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />{exportAll.isPending ? 'Preparing…' : 'Export everything'}
        </button>
      }
    >
      {status.isError && <p className="sk-state err">The counts could not load. The sheets below still work.</p>}
      {st && (
        <HubKpis>
          <HubKpi href="/app/classes" label={st.year ? `Sections · ${st.year.name}` : 'Sections'} value={st.sections.toLocaleString('en-IN')} hint={`${st.grades} ${st.grades === 1 ? 'class' : 'classes'}`} tone={st.sections ? 'good' : undefined} />
          <HubKpi href="/app/teachers" label="Teachers on roll" value={st.teachers.toLocaleString('en-IN')} hint={st.teachers ? 'names, posts, safety checks' : 'none yet — the second sheet'} tone={st.teachers ? 'good' : undefined} />
          <HubKpi href="/app/students" label={st.year ? `Students · ${st.year.name}` : 'Students on roll'} value={st.students.toLocaleString('en-IN')} hint={st.students ? 'placed in their sections' : 'none yet — the third sheet'} tone={st.students ? 'good' : undefined} />
          <HubKpi
            label="Last import" value={last ? KIND_LABEL[last.kind] : '—'}
            hint={last ? `${last.created.toLocaleString('en-IN')} added · ${fmtDay(last.createdAt)}` : 'nothing imported yet'}
            tone={last && last.failed ? 'warn' : undefined}
          />
        </HubKpis>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {KINDS.map((k, i) => (
          <KindCard key={k.kind} {...k} step={i + 1} have={st ? have[k.kind] : null} api={api} years={years} defaultYearId={current?.id ?? ''} onImported={() => {
            void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
            void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
            void queryClient.invalidateQueries({ queryKey: ['mng-classes'] });
            void queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
          }} />
        ))}
      </div>

      <HubList
        title="Imports" label="Imports"
        columns="minmax(0, 1.6fr) minmax(0, 1fr) auto auto"
        count={imports.length}
        empty={status.isLoading ? 'Looking for imports…' : 'No file has been imported yet. Every import you run is listed here — the file, how many rows went in, and any that were refused.'}
      >
        {imports.map((r) => (
          <Row key={r.id}>
            <Cell><RowTitle title={r.fileName} sub={KIND_LABEL[r.kind]} /></Cell>
            <Cell>
              <RowTitle
                title={`${r.created.toLocaleString('en-IN')} added`}
                sub={[r.skipped ? `${r.skipped} skipped` : null, r.failed ? `${r.failed} refused` : null].filter(Boolean).join(' · ') || `${r.rows} ${r.rows === 1 ? 'row' : 'rows'}`}
                tone={r.failed ? 'warn' : undefined}
              />
            </Cell>
            <Cell align="end"><span className="sk-pill" data-tone={r.failed ? 'warn' : 'good'}>{r.failed ? 'Partly' : 'Imported'}</span></Cell>
            <Cell align="end"><span className="sk-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDay(r.createdAt)}</span></Cell>
          </Row>
        ))}
      </HubList>
    </HubPage>
  );
}

function KindCard({ kind, title, what, needsSession, step, have, api, years, defaultYearId, onImported }: {
  kind: Kind; title: string; what: string; needsSession: boolean; step: number;
  /** How many of this kind the school has on file; null while unknown. */
  have: number | null;
  api: ReturnType<typeof useApi>; years: SessionYear[]; defaultYearId: string; onImported: () => void;
}) {
  const [yearId, setYearId] = useState('');
  const year = yearId || defaultYearId;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = needsSession && year ? `?academicYearId=${encodeURIComponent(year)}` : '';

  const download = useMutation({
    mutationFn: async (which: 'template' | 'export') => {
      const { blob, filename } = await api.download(`/manage/onboarding/${which}/${kind}`);
      saveBlob(blob, filename ?? `sckools-${kind}-${which}.xlsx`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const check = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose the filled-in file first.');
      const fd = new FormData(); fd.append('file', file);
      return api.postForm<Preview>(`/manage/onboarding/preview/${kind}${q}`, fd);
    },
    onSuccess: (p) => { setPreview(p); setResult(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const run = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose the filled-in file first.');
      const fd = new FormData(); fd.append('file', file);
      return api.postForm<ImportResult>(`/manage/onboarding/import/${kind}${q}`, fd);
    },
    onSuccess: (r) => {
      setResult(r); setPreview(null); setFile(null); onImported();
      toast.success(r.failed.length ? `Imported ${r.created} — ${r.failed.length} could not be added` : `Imported ${r.created} ${title.toLowerCase()}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clean = preview && preview.issues.length === 0 && preview.total > 0;
  const rowsOf = (p: Preview) => p.sample.length ? Object.keys(p.sample[0]).filter((k) => k !== 'row' && k !== 'classSectionId' && k !== '__skip') : [];

  return (
    <section className="sk-card" data-step={step} data-state={have === null ? undefined : have > 0 ? 'done' : 'todo'}>
      <div className="sk-card-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{title}</h3>
          {/* "On file" is a fact, not a step state: this kind of data exists,
              whether it came from a sheet or was typed in. Beside the heading,
              not inside it, so the heading's name stays the title alone. */}
          {have !== null && (
            <span className="sk-pill" data-tone={have > 0 ? 'good' : 'neutral'} data-testid={`${kind}-on-file`}>{have > 0 ? `${have.toLocaleString('en-IN')} on file` : 'none yet'}</span>
          )}
        </div>
        <div className="sk-actions">
          <button className="sk-btn sk-press" disabled={download.isPending} onClick={() => download.mutate('template')}><Download className="h-3.5 w-3.5" />Blank template</button>
          <button className="sk-btn sk-press" disabled={download.isPending} onClick={() => download.mutate('export')}><Download className="h-3.5 w-3.5" />Export what we have</button>
        </div>
      </div>
      <div className="sk-card-b" style={{ display: 'grid', gap: 14 }}>
        <p className="sk-muted" style={{ margin: 0 }}>{what}</p>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', alignItems: 'end' }}>
          {needsSession && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
              <label className="sk-lab" htmlFor={`${kind}-year`}>Session</label>
              <select id={`${kind}-year`} className="sk-input" value={year} onChange={(e) => { setYearId(e.target.value); setPreview(null); }}>
                {years.length === 0 && <option value="">No sessions yet</option>}
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' · current' : ''}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <label className="sk-lab" htmlFor={`${kind}-file`}>Filled-in file (.xlsx)</label>
            <div className="sk-actions">
              <input ref={inputRef} id={`${kind}-file`} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); }} />
              <button type="button" className="sk-btn sk-press" onClick={() => inputRef.current?.click()}><Upload className="h-3.5 w-3.5" />{file ? 'Change file' : 'Choose file'}</button>
              <span className="sk-muted" style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file ? file.name : 'Nothing chosen yet'}</span>
            </div>
          </div>
          <div className="sk-actions">
            <button className="sk-btn sk-press" disabled={!file || check.isPending || (needsSession && !year)} onClick={() => check.mutate()}>{check.isPending ? 'Checking…' : 'Check the file'}</button>
            <button className="sk-btn sk-press" data-variant="primary" disabled={!clean || run.isPending} onClick={() => run.mutate()} title={clean ? undefined : 'Check the file first — import opens once every row passes'}>{run.isPending ? 'Importing…' : `Import ${preview?.ok ?? ''}`.trim()}</button>
          </div>
        </div>

        {preview && (
          <div className="sk-notice" data-tone={preview.issues.length ? 'warn' : 'good'} role="status">
            <p className="nt" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {preview.issues.length ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              {preview.issues.length
                ? `${preview.issues.length} problem${preview.issues.length === 1 ? '' : 's'} in ${preview.total - preview.ok} of ${preview.total} rows — nothing was imported`
                : `${preview.total} row${preview.total === 1 ? '' : 's'} ready${preview.skipped ? ` · ${preview.skipped} already exist and will be skipped` : ''}`}
            </p>
            {preview.issues.length > 0 && (
              <div className="sk-tablewrap" style={{ marginTop: 8 }}>
                <table className="sk-table">
                  <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
                  <tbody>
                    {preview.issues.slice(0, 200).map((i, n) => <tr key={n}><td>{i.row}</td><td>{i.column}</td><td style={{ whiteSpace: 'normal' }}>{i.message}</td></tr>)}
                  </tbody>
                </table>
                {preview.issues.length > 200 && <p className="sk-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Showing the first 200. Fix these and check again.</p>}
              </div>
            )}
            {preview.issues.length === 0 && preview.sample.length > 0 && (
              <div className="sk-tablewrap" style={{ marginTop: 8 }}>
                <table className="sk-table">
                  <thead><tr><th>Row</th>{rowsOf(preview).slice(0, 6).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                  <tbody>{preview.sample.map((r) => <tr key={String(r.row)}><td>{String(r.row)}</td>{rowsOf(preview).slice(0, 6).map((k) => <td key={k}>{String(r[k] ?? '')}</td>)}</tr>)}</tbody>
                </table>
                <p className="sk-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>The first rows, as they will be imported.</p>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="sk-notice" data-tone={result.failed.length ? 'warn' : 'good'} role="status">
            <p className="nt">Imported {result.created}{result.skipped ? ` · ${result.skipped} skipped` : ''}{result.failed.length ? ` · ${result.failed.length} could not be added` : ''}</p>
            {result.failed.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>{result.failed.map((f, n) => <li key={n}>Row {f.row}: {f.message}</li>)}</ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
