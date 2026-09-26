'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { saveBlob } from '@/lib/save-blob';

/**
 * ONBOARDING — the things that take a new school days, done from a sheet.
 *
 * Three kinds, each with a template to download, a filled file to check, and
 * an import that only runs once the check is clean. The same tab exports
 * what the school has today, in the same layout, so a school can round-trip:
 * export, edit in Excel, re-import next session.
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

interface Issue { row: number; column: string; message: string }
interface Preview { kind: Kind; total: number; ok: number; issues: Issue[]; sample: Record<string, unknown>[]; skipped?: number }
interface ImportResult { created: number; skipped: number; failed: Issue[] }
interface SessionYear { id: string; name: string; isCurrent: boolean }

export default function OnboardingPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions', host],
    queryFn: () => api.get<{ years?: SessionYear[] }>('/manage/sessions'),
    staleTime: 60_000, refetchOnWindowFocus: false, enabled: !!host,
  });
  const years = sessions.data?.years ?? [];
  const current = years.find((y) => y.isCurrent) ?? null;

  return (
    <div className="sk-page">
      <header className="sk-pagehead sk-wrap-sm" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Onboarding</h1>
          <p>Set a school up from spreadsheets: download a template, fill it in Excel, check it, import. Export the same sheets any time.</p>
        </div>
      </header>

      <div style={{ display: 'grid', gap: 16 }}>
        {KINDS.map((k) => (
          <KindCard key={k.kind} {...k} api={api} years={years} defaultYearId={current?.id ?? ''} onImported={() => {
            void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
            void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
            void queryClient.invalidateQueries({ queryKey: ['mng-classes'] });
          }} />
        ))}
      </div>
    </div>
  );
}

function KindCard({ kind, title, what, needsSession, api, years, defaultYearId, onImported }: {
  kind: Kind; title: string; what: string; needsSession: boolean;
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
    <section className="sk-card">
      <div className="sk-card-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{title}</h3>
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
