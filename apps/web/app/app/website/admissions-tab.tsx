'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

interface StepRow {
  title: string;
  description: string;
}

interface AdmissionsData {
  steps: { title: string; description: string | null; order: number }[];
  settings: { showFeesPublicly: boolean; feeNote: string | null };
}

export default function AdmissionsTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['site-admissions'],
    queryFn: () => api.get<AdmissionsData>('/site/admissions'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const [steps, setSteps] = useState<StepRow[]>([]);
  const [showFees, setShowFees] = useState(true);
  const [feeNote, setFeeNote] = useState('');

  // Hydrate local form state once per fetch.
  useEffect(() => {
    if (!query.data) return;
    setSteps(query.data.steps.map((s) => ({ title: s.title, description: s.description ?? '' })));
    setShowFees(query.data.settings.showFeesPublicly);
    setFeeNote(query.data.settings.feeNote ?? '');
  }, [query.data]);

  const saveSteps = useMutation({
    mutationFn: () =>
      api.put('/site/admissions/steps', {
        steps: steps
          .filter((s) => s.title.trim())
          .map((s, order) => ({ title: s.title.trim(), description: s.description.trim() || undefined, order })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-admissions'] });
      toast.success('Admission steps saved');
    },
    onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api.put('/site/admissions/settings', {
        showFeesPublicly: showFees,
        feeNote: feeNote.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-admissions'] });
      toast.success('Fee settings saved');
    },
    onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
  });

  function updateStep(idx: number, field: keyof StepRow, val: string) {
    setSteps((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  return (
    <div className="space-y-6 w-full">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Admissions</h2>
        <p className="text-sm text-slate-500">
          The Admissions section on your website: the application process and the fee table.
          Fee amounts themselves are set per course in the Courses tab.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Admission process steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 && (
            <p className="text-sm text-slate-400">No steps yet — add the first one below.</p>
          )}
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
              <span className="mt-2 text-xs font-bold text-slate-400 w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <div className="flex-1 space-y-2">
                <Input value={s.title} onChange={(e) => updateStep(i, 'title', e.target.value)} placeholder="Step title (e.g. Campus visit)" />
                <Input value={s.description} onChange={(e) => updateStep(i, 'description', e.target.value)} placeholder="One line describing this step (optional)" />
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                  className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  aria-label="Remove step"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" disabled={steps.length >= 10} onClick={() => setSteps((p) => [...p, { title: '', description: '' }])}>
            <Plus className="h-4 w-4 mr-1" /> Add step
          </Button>
        </CardContent>
        <CardFooter>
          <Button onClick={() => saveSteps.mutate()} disabled={saveSteps.isPending}>
            {saveSteps.isPending ? 'Saving…' : 'Save steps'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fee table</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showFees}
              onChange={(e) => setShowFees(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-emerald-700"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">Show fee structure publicly</span>
              <span className="block text-xs text-slate-500">
                Off = only the process steps appear on the website; the fee table is hidden.
              </span>
            </span>
          </label>
          <div className="space-y-2">
            <Label htmlFor="fee-note">Fee note (shown under the table)</Label>
            <Input
              id="fee-note"
              value={feeNote}
              onChange={(e) => setFeeNote(e.target.value)}
              placeholder="Sibling discount 10% · Transport billed separately by route"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
            {saveSettings.isPending ? 'Saving…' : 'Save fee settings'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
