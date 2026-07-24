'use client';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import type { BlogBlock } from './types';

const MAX_BLOCKS = 40;

const BLOCK_LABELS: Record<BlogBlock['t'], string> = {
  h: 'Heading',
  p: 'Paragraph',
  ul: 'List',
  img: 'Image',
  stats: 'Stat cards',
  ranking: 'Ranking',
  quiz: 'Quiz',
};

function newBlock(t: BlogBlock['t']): BlogBlock {
  switch (t) {
    case 'h':
      return { t: 'h', text: '' };
    case 'p':
      return { t: 'p', text: '' };
    case 'ul':
      return { t: 'ul', items: [''] };
    case 'img':
      return { t: 'img', url: '', alt: '', caption: '' };
    case 'stats':
      return { t: 'stats', items: [{ value: '', label: '', tone: undefined }] };
    case 'ranking':
      return { t: 'ranking', items: [{ label: '', value: '', pct: 0 }], source: '' };
    case 'quiz':
      return { t: 'quiz', tag: '', q: '', options: ['', ''], correct: 0, why: '' };
  }
}

export default function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: BlogBlock[];
  onChange: (blocks: BlogBlock[]) => void;
}) {
  function addBlock(t: BlogBlock['t']) {
    onChange([...blocks, newBlock(t)]);
  }

  function updateBlock(idx: number, block: BlogBlock) {
    const next = [...blocks];
    next[idx] = block;
    onChange(next);
  }

  function removeBlock(idx: number) {
    onChange(blocks.filter((_, i) => i !== idx));
  }

  function moveBlock(idx: number, dir: -1 | 1) {
    const swap = idx + dir;
    if (swap < 0 || swap >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Add block:</span>
        {(Object.keys(BLOCK_LABELS) as BlogBlock['t'][]).map((t) => (
          <Button
            key={t}
            type="button"
            variant="outline"
            size="sm"
            disabled={blocks.length >= MAX_BLOCKS}
            onClick={() => addBlock(t)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {BLOCK_LABELS[t]}
          </Button>
        ))}
      </div>
      {blocks.length >= MAX_BLOCKS && (
        <p className="text-xs text-amber-600">A post can have at most {MAX_BLOCKS} blocks.</p>
      )}

      {blocks.length === 0 && (
        <p className="text-sm text-slate-400">No blocks yet. Add one above to start writing.</p>
      )}

      <div className="space-y-3">
        {blocks.map((block, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-teal-700">
                {BLOCK_LABELS[block.t]}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={idx === 0}
                  onClick={() => moveBlock(idx, -1)}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={idx === blocks.length - 1}
                  onClick={() => moveBlock(idx, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeBlock(idx)}
                  aria-label="Remove block"
                  className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <BlockFields block={block} onChange={(b) => updateBlock(idx, b)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BlockFields({ block, onChange }: { block: BlogBlock; onChange: (b: BlogBlock) => void }) {
  switch (block.t) {
    case 'h':
      return (
        <div className="space-y-1.5">
          <Label>Heading text</Label>
          <Input value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} placeholder="Why this matters" />
        </div>
      );

    case 'p':
      return (
        <div className="space-y-1.5">
          <Label>Paragraph text</Label>
          <Textarea rows={4} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} placeholder="Write a paragraph…" />
        </div>
      );

    case 'ul':
      return (
        <div className="space-y-1.5">
          <Label>List items (one per line)</Label>
          <Textarea
            rows={4}
            value={block.items.join('\n')}
            onChange={(e) => onChange({ ...block, items: e.target.value.split('\n') })}
            placeholder={'First point\nSecond point'}
          />
        </div>
      );

    case 'img':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label hint="https:// URL, or a path starting with / (e.g. from your gallery)">Image URL</Label>
            <Input value={block.url} onChange={(e) => onChange({ ...block, url: e.target.value })} placeholder="https://… or /media/…" />
          </div>
          <div className="space-y-1.5">
            <Label>Alt text</Label>
            <Input value={block.alt} onChange={(e) => onChange({ ...block, alt: e.target.value })} placeholder="Describe the image" />
          </div>
          <div className="space-y-1.5">
            <Label>Caption (optional)</Label>
            <Input value={block.caption ?? ''} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
          </div>
        </div>
      );

    case 'stats': {
      const items = block.items;
      const set = (i: number, patch: Partial<(typeof items)[number]>) => {
        const next = [...items];
        next[i] = { ...next[i], ...patch };
        onChange({ ...block, items: next });
      };
      return (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={it.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="87%" className="w-24 shrink-0 font-mono" />
              <Input value={it.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label" />
              <Select
                value={it.tone ?? ''}
                onChange={(e) => set(i, { tone: (e.target.value || undefined) as 'good' | 'bad' | undefined })}
                className="w-32 shrink-0"
              >
                <option value="">No tone</option>
                <option value="good">Good</option>
                <option value="bad">Bad</option>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange({ ...block, items: items.filter((_, j) => j !== i) })}
                className="shrink-0 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                aria-label="Remove stat"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...block, items: [...items, { value: '', label: '', tone: undefined }] })}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add stat
          </Button>
        </div>
      );
    }

    case 'ranking': {
      const items = block.items;
      const set = (i: number, patch: Partial<(typeof items)[number]>) => {
        const next = [...items];
        next[i] = { ...next[i], ...patch };
        onChange({ ...block, items: next });
      };
      return (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={it.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label" className="flex-1" />
              <Input value={it.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="Value" className="w-24 shrink-0" />
              <Input
                type="number"
                min={0}
                max={100}
                value={it.pct}
                onChange={(e) => set(i, { pct: Number(e.target.value) })}
                placeholder="Pct"
                className="w-20 shrink-0"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange({ ...block, items: items.filter((_, j) => j !== i) })}
                className="shrink-0 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                aria-label="Remove row"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...block, items: [...items, { label: '', value: '', pct: 0 }] })}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add row
          </Button>
          <div className="space-y-1.5 pt-1">
            <Label>Source (optional)</Label>
            <Input value={block.source ?? ''} onChange={(e) => onChange({ ...block, source: e.target.value })} placeholder="Where this data comes from" />
          </div>
        </div>
      );
    }

    case 'quiz': {
      const options = block.options;
      const setOption = (i: number, value: string) => {
        const next = [...options];
        next[i] = value;
        onChange({ ...block, options: next });
      };
      const removeOption = (i: number) => {
        const next = options.filter((_, j) => j !== i);
        const correct = block.correct === i ? 0 : block.correct > i ? block.correct - 1 : block.correct;
        onChange({ ...block, options: next, correct });
      };
      return (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Question</Label>
            <Textarea rows={2} value={block.q} onChange={(e) => onChange({ ...block, q: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label hint="Select the radio button next to the correct answer">Options (2–4)</Label>
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`quiz-correct-${block.q.slice(0, 8)}-${i}`}
                  checked={block.correct === i}
                  onChange={() => onChange({ ...block, correct: i })}
                  className="h-4 w-4 shrink-0 accent-teal-700"
                  aria-label={`Mark option ${i + 1} as correct`}
                />
                <Input value={opt} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={options.length <= 2}
                  onClick={() => removeOption(i)}
                  className="shrink-0 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  aria-label="Remove option"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={options.length >= 4}
              onClick={() => onChange({ ...block, options: [...options, ''] })}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add option
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Explanation (&quot;why&quot;)</Label>
            <Textarea rows={2} value={block.why} onChange={(e) => onChange({ ...block, why: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Tag (optional)</Label>
            <Input value={block.tag ?? ''} onChange={(e) => onChange({ ...block, tag: e.target.value })} placeholder="e.g. Quick check" />
          </div>
        </div>
      );
    }
  }
}
