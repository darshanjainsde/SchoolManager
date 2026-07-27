'use client';
import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

// ── ImageUploader — reusable upload control ──────────────────────────────────

interface ImageUploaderProps {
  label: string;
  hint?: string;
  previewUrl?: string | null;
  hasExistingAsset?: boolean;
  isUploading: boolean;
  accept?: string;
  onFile: (file: File) => void;
}

export default function ImageUploader({
  label,
  hint,
  previewUrl,
  hasExistingAsset,
  isUploading,
  accept = 'image/*',
  onFile,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    // reset so the same file can be re-selected after an error
    e.target.value = '';
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}

      {/* Preview or placeholder */}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={label}
          className="h-24 w-auto rounded border border-slate-200 object-contain"
        />
      ) : hasExistingAsset ? (
        <p className="text-sm text-slate-500 italic">Current asset set — upload a new file to replace.</p>
      ) : (
        <p className="text-sm text-slate-400">No image set.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4 mr-1" />
        {isUploading ? 'Uploading…' : previewUrl || hasExistingAsset ? 'Replace image' : 'Upload image'}
      </Button>
    </div>
  );
}

// ── Page component ───────────────────────────────────────────────────────────
