'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { EVENT_ART, ART_KEYS, EventArt, guessArt, type ArtKey } from '../../event-art';
import { PIECES, Sheet, piecePaper, type PaperSize, type PieceKey, type SheetData } from '../../promo/sheets';
import { downloadPdf, downloadPng, fileStem, makeQr } from '../../promo/export';

/**
 * The desk payload. The Promo Kit reads the SAME endpoint the "who's coming"
 * page does rather than adding a second one: the row is already loaded there,
 * and the RSVP count is worth showing beside a poster that asks for RSVPs.
 */
interface EventDesk {
  event: {
    id: string;
    title: string;
    description?: string | null;
    startAt: string;
    endAt?: string | null;
    venue?: string | null;
    coverArt?: string | null;
  };
  counts: { seats: number };
}

function whenLabel(startAt: string): string {
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

/**
 * The Promo Kit — everything a school needs to put an event on a wall.
 *
 * Schools promote offline. A notice board at the gate reaches more parents
 * than any push notification, and until now the only way to get an event onto
 * one was to retype it into Word. Every piece here is drawn from the event's
 * own fields, so the date on the poster cannot drift from the date in the app.
 *
 * The primary output is a FILE, not a print dialog: the person who prints a
 * school poster is usually a shop down the road who needs something to open.
 * Printing here, and ordering through the Print Store, are the other two doors.
 */
export default function PromoKitPage() {
  const params = useParams<{ id: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const [piece, setPiece] = useState<PieceKey>('poster');
  const [size, setSize] = useState<PaperSize>('A3');
  const [colour, setColour] = useState(true);
  const [artOverride, setArtOverride] = useState<ArtKey | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'png' | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const desk = useQuery({
    queryKey: ['event-desk', params.id, host],
    enabled: !!host && !!params.id,
    queryFn: () => api.get<EventDesk>(`/manage/events/${params.id}/registrations`),
  });
  const event = desk.data?.event;

  const publicUrl = useMemo(() => `${host ? host.split(':')[0] : 'your-school.sckools.com'}/events`, [host]);

  useEffect(() => {
    let alive = true;
    void makeQr(`https://${publicUrl}`).then((d) => {
      if (alive) setQr(d);
    });
    return () => {
      alive = false;
    };
  }, [publicUrl]);

  const art: ArtKey = artOverride ?? (event?.coverArt as ArtKey | undefined) ?? guessArt(event?.title ?? '');

  const data: SheetData | null = event
    ? {
        title: event.title,
        when: whenLabel(event.startAt),
        venue: event.venue ?? '',
        blurb: event.description ?? null,
        schoolName: host ? host.split('.')[0].replace(/^\w/, (c) => c.toUpperCase()) : 'Our school',
        url: publicUrl,
        art,
        qr,
      }
    : null;

  async function take(kind: 'pdf' | 'png') {
    const svg = sheetRef.current?.querySelector('svg');
    if (!svg || !data) return;
    setBusy(kind);
    try {
      const paper = piecePaper(piece, size);
      const name = fileStem(data.title, piece);
      if (kind === 'pdf') await downloadPdf(svg as SVGSVGElement, paper, name);
      else await downloadPng(svg as SVGSVGElement, paper, name);
      toast.success(kind === 'pdf' ? 'PDF saved — print-ready at 300 dpi' : 'Image saved at 300 dpi');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (desk.isLoading) return <p className="sk-state">Opening the kit…</p>;
  if (desk.error || !data) {
    return <p className="sk-state err">{(desk.error as Error)?.message ?? 'That event could not be found.'}</p>;
  }

  const paper = piecePaper(piece, size);
  const meta = PIECES[piece];

  return (
    <div className="skosx">
      <header className="sk-pagehead">
        <div>
          <h1>Promo Kit</h1>
          <p>
            Four pieces, drawn from {data.title}. Download the file, print it here, or have it printed
            for you.
          </p>
        </div>
        <Link className="sk-btn" href={`/app/events/${params.id}`}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to the event
        </Link>
      </header>

      <div className="sk-ev-kit">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <p className="sk-lab" style={{ marginBottom: 7 }}>The pieces</p>
            <div className="sk-ev-pieces" role="group" aria-label="Choose a piece">
              {(Object.keys(PIECES) as PieceKey[]).map((k) => {
                const p = PIECES[k];
                const wide = k === 'invite';
                return (
                  <button
                    key={k}
                    type="button"
                    className="sk-ev-piece"
                    aria-pressed={piece === k}
                    onClick={() => {
                      setPiece(k);
                      if (!PIECES[k].sizes.includes(size)) setSize(PIECES[k].sizes[0]);
                    }}
                  >
                    <span className="fig">
                      <i style={{ width: wide ? 20 : 14, height: wide ? 13 : 19 }} />
                    </span>
                    <span>
                      <span className="nm">{p.name}</span>
                      <span className="sz">{p.sizeLabel}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sk-card">
            <div className="sk-card-h"><h3>Paper</h3></div>
            <div className="sk-card-b">
              {meta.sizes.length > 1 ? (
                <div>
                  <p className="sk-lab" style={{ marginBottom: 5 }}>Size</p>
                  <div className="sk-seg">
                    {meta.sizes.map((s) => (
                      <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div>
                <p className="sk-lab" style={{ marginBottom: 5 }}>Ink</p>
                <div className="sk-seg">
                  <button type="button" aria-pressed={colour} onClick={() => setColour(true)}>Colour</button>
                  <button type="button" aria-pressed={!colour} onClick={() => setColour(false)}>Black &amp; white</button>
                </div>
              </div>
              <p className="sk-muted" style={{ fontSize: 11.5 }}>
                {paper.w} × {paper.h} mm · {colour ? 'colour' : 'black & white'} · exported at 300 dpi
              </p>
            </div>
          </div>

          <div className="sk-card">
            <div className="sk-card-h"><h3>Cover</h3></div>
            <div className="sk-card-b">
              <div className="sk-ev-artrow">
                {ART_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="sk-ev-artpick"
                    aria-pressed={art === k}
                    aria-label={EVENT_ART[k].name}
                    title={EVENT_ART[k].name}
                    onClick={() => setArtOverride(k)}
                  >
                    <EventArt kind={k} />
                  </button>
                ))}
              </div>
              <p className="sk-muted" style={{ fontSize: 11.5 }}>
                Every piece uses the same artwork, so the poster on the gate and the slip in a pocket
                are recognisably the same event.
              </p>
            </div>
          </div>

          <div className="sk-card">
            <div className="sk-card-h"><h3>Take it away</h3></div>
            <div className="sk-card-b">
              <button
                className="sk-btn"
                data-variant="primary"
                type="button"
                disabled={busy !== null}
                onClick={() => void take('pdf')}
              >
                {busy === 'pdf' ? 'Making the PDF…' : `Download PDF · ${piece === 'poster' ? size : 'A4'}`}
              </button>
              <button className="sk-btn" type="button" disabled={busy !== null} onClick={() => void take('png')}>
                {busy === 'png' ? 'Making the image…' : 'Download PNG · 300 dpi'}
              </button>
              <button className="sk-btn" type="button" onClick={() => window.print()}>
                Print here
              </button>
              <p className="sk-muted" style={{ fontSize: 11.5 }}>
                The PDF is the file a local press can open. The PNG is for WhatsApp and your own
                social posts.
              </p>
              <div style={{ borderTop: '1px solid var(--sk-line)', paddingTop: 9, display: 'grid', gap: 7 }}>
                <p className="sk-lab" style={{ margin: 0 }}>Or let us print it</p>
                <p className="sk-muted" style={{ fontSize: 11.5 }}>
                  Send it to the Print Store for a quote — the same desk that prints your report cards.
                </p>
                <Link className="sk-btn" data-size="sm" href="/app/press/orders">
                  Open the Print Store →
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="sk-ev-sheetwrap">
            <div
              className="sk-ev-sheet"
              data-mono={!colour}
              data-wide={piece === 'invite'}
              ref={sheetRef}
            >
              <Sheet piece={piece} size={size} data={data} />
            </div>
          </div>
          <p className="sk-muted" style={{ marginTop: 10, fontSize: 12 }}>{meta.note}</p>
        </div>
      </div>
    </div>
  );
}
