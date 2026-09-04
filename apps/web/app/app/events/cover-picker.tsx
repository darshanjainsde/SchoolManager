'use client';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ApiClient } from '@/lib/api';
import { ART_KEYS, EVENT_ART, EventArt, type ArtKey } from './event-art';

export type Focus = 'top' | 'middle' | 'bottom';

export interface CoverChoice {
  art: ArtKey;
  /** The uploaded photo's public URL, or null when the drawing is being used. */
  photoUrl: string | null;
  assetId: string | null;
  focus: Focus;
}

const FOCI: { key: Focus; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Middle' },
  { key: 'bottom', label: 'Bottom' },
];

/**
 * Shows what a 16:9 tile will actually keep of a photograph.
 *
 * A cover is a fixed window and most photographs are not 16:9, so something is
 * always thrown away. Cropping silently is how a portrait photo of a child
 * ends up on the events page with the head cut off — the school only finds out
 * when a parent mentions it. The window is drawn over the whole picture, the
 * discarded bands are dimmed, and the band that survives can be moved.
 */
export function CropPreview({ src, focus }: { src: string; focus: Focus }) {
  const [ratio, setRatio] = useState<number | null>(null);
  // How tall the kept band is, as a fraction of the whole picture.
  const keep = ratio ? Math.min(1, ratio / (16 / 9)) : 1;
  const pct = keep * 100;
  const top = focus === 'top' ? 0 : focus === 'bottom' ? 100 - pct : (100 - pct) / 2;

  return (
    <div className="sk-ev-croppreview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="The picture you chose, with the part the card keeps marked"
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalHeight > 0) setRatio(el.naturalWidth / el.naturalHeight);
        }}
      />
      {keep < 0.995 ? (
        <div className="sk-ev-cropmask" aria-hidden="true">
          <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${top}%`, background: 'rgba(20,16,50,.62)' }} />
          <span style={{ position: 'absolute', left: 0, right: 0, top: `${top + pct}%`, bottom: 0, background: 'rgba(20,16,50,.62)' }} />
          <span className="sk-ev-cropwin" style={{ top: `${top}%`, height: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Choose a cover: one of the drawn archetypes, or the school's own photograph.
 *
 * The upload is the control the rebuild of this page dropped — an event could
 * still SHOW a photo but there was no longer any way to give it one.
 */
export function CoverPicker({
  api,
  value,
  onChange,
  guessed,
}: {
  api: ApiClient;
  value: CoverChoice;
  onChange: (next: CoverChoice) => void;
  /** What the title suggests, shown when nothing has been chosen by hand. */
  guessed?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image.');
      return;
    }
    // 8 MB: a phone photo is 3–5 MB and the API rejects more than this anyway.
    if (file.size > 8 * 1024 * 1024) {
      toast.error('That image is larger than 8 MB — please use a smaller one.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // postForm, never post: `post` JSON.stringifies, and a FormData
      // stringifies to the two characters `{}` — see lib/api.ts.
      const asset = await api.postForm<{ id: string; url: string }>('/site/media?kind=EVENT', fd);
      onChange({ ...value, photoUrl: asset.url, assetId: asset.id });
      toast.success('Picture added.');
    } catch (e) {
      toast.error(`That picture could not be uploaded — ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="sk-seg" role="group" aria-label="Cover source">
        <button type="button" aria-pressed={!value.photoUrl} onClick={() => onChange({ ...value, photoUrl: null, assetId: null })}>
          Artwork
        </button>
        <button type="button" aria-pressed={!!value.photoUrl} onClick={() => fileRef.current?.click()}>
          {value.photoUrl ? 'Your picture' : 'Use a picture'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />

      {value.photoUrl ? (
        <>
          <CropPreview src={value.photoUrl} focus={value.focus} />
          <div style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Which part to keep</span>
            <div className="sk-seg" role="group" aria-label="Which part of the picture to keep">
              {FOCI.map((f) => (
                <button key={f.key} type="button" aria-pressed={value.focus === f.key} onClick={() => onChange({ ...value, focus: f.key })}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="sk-ev-outrow">
            <button className="sk-btn" data-size="sm" type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Replace picture'}
            </button>
            <button className="sk-btn" data-size="sm" type="button" onClick={() => onChange({ ...value, photoUrl: null, assetId: null })}>
              Use the artwork instead
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sk-ev-artrow">
            {ART_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className="sk-ev-artpick"
                aria-pressed={value.art === k}
                aria-label={EVENT_ART[k].name}
                title={EVENT_ART[k].name}
                onClick={() => onChange({ ...value, art: k })}
              >
                <EventArt kind={k} />
              </button>
            ))}
          </div>
          <span className="sk-muted" style={{ fontSize: 11 }}>
            {uploading
              ? 'Uploading your picture…'
              : guessed
                ? `${EVENT_ART[value.art].name} — picked from the title. Choose another, or use a picture of your own.`
                : `${EVENT_ART[value.art].name}, chosen by hand.`}
          </span>
        </>
      )}
    </div>
  );
}
