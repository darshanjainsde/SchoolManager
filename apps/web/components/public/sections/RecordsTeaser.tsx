import Link from 'next/link';
import type { RecordLine, RecordsBook } from '@/lib/public-api';

export type RecordsHomeLayout = 'BOARD' | 'CABINET' | 'STRIP' | 'TILES';

/** The lines the office chose for the homepage, in its order; only lines with a record are ever here. */
export function homeLines(book: RecordsBook): RecordLine[] {
  const byKey = new Map(book.lines.map((l) => [l.key, l]));
  return book.home.map((k) => byKey.get(k)).filter((l): l is RecordLine => !!l && !!l.record);
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]?.toUpperCase() ?? '').slice(0, 2).join('') || '·';

/**
 * The homepage band: four layouts for the same holders. STRIP renders as a
 * ribbon under the menu (PublicSite places it there); the other three are
 * bands in the school's saved order. Every one links to the full book.
 */
export default function RecordsTeaser({ book, layout, bandClass = '', href = '/records' }: { book: RecordsBook; layout: RecordsHomeLayout; bandClass?: string; href?: string }) {
  const lines = homeLines(book);
  if (lines.length === 0) return null;
  const thisYear = new Date().getUTCFullYear();

  if (layout === 'STRIP') {
    const items = lines.map((l) => `${l.sportName} · ${l.record!.text} · ${l.record!.name}, ${l.record!.year}`);
    return (
      <Link href={href} className="ps-rec-strip" aria-label={`School records: ${items.join('; ')}. Open the Book of Records.`}>
        <span className="ps-rec-strip-lead">School records</span>
        <span className="ps-rec-strip-view" aria-hidden="true">
          <span className="ps-rec-strip-track">
            {[...items, ...items].map((t, i) => <span key={i}><b>{t.split(' · ')[1]}</b> {t.replace(/^[^·]+· [^·]+· /, '')} <i>{t.split(' · ')[0]}</i></span>)}
          </span>
        </span>
      </Link>
    );
  }

  const cls = layout === 'BOARD' ? 'ps-rec-t-board' : layout === 'CABINET' ? 'ps-rec-t-cab' : 'ps-rec-t-tiles';
  const broken = lines.filter((l) => l.record!.year === thisYear).length;
  return (
    <section id="records-home" data-sec="records" className={`ps-rec-t ${cls} ${bandClass}`.trim()} aria-labelledby="ps-rec-t-title">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <header className="ps-rec-t-head">
          <div>
            <p className="ps-eyebrow ps-rec-eyebrow">{layout === 'CABINET' ? 'Book of Records' : 'School records'}</p>
            <h2 id="ps-rec-t-title" className="ps-head ps-rec-t-h">{layout === 'BOARD' ? 'The board' : layout === 'CABINET' ? 'The cabinet' : 'Fastest, furthest, highest'}</h2>
          </div>
          {layout === 'TILES' && broken > 0 && <span className="ps-rec-new">{broken} set this year</span>}
          <Link href={href} className="ps-rec-more">Full Book of Records →</Link>
        </header>

        {layout === 'BOARD' && (
          <div className="ps-rec-t-grid">
            {lines.map((l) => (
              <div key={l.key} className="ps-rec-cell">
                <span className="ps-rec-cell-sp">{l.sportName} · {l.groupLabel} {l.category}</span>
                <span className="ps-rec-cell-v">{l.record!.text}</span>
                <span className="ps-rec-cell-who">{l.record!.name} <span>· {l.record!.year}</span></span>
              </div>
            ))}
          </div>
        )}

        {layout === 'CABINET' && (
          <div className="ps-rec-shelf">
            <div className="ps-rec-plaques">
              {lines.map((l) => (
                <div key={l.key} className="ps-rec-plaque">
                  <span className="ps-rec-plaque-sp">{l.sportName} · {l.groupLabel} {l.category}</span>
                  <span className="ps-rec-plaque-v">{l.record!.text}</span>
                  <span className="ps-rec-plaque-who">{l.record!.name}</span>
                  <span className="ps-rec-plaque-yr">since {l.record!.year}</span>
                </div>
              ))}
            </div>
            <div className="ps-rec-glass" aria-hidden="true" />
            <div className="ps-rec-board" aria-hidden="true" />
          </div>
        )}

        {layout === 'TILES' && (
          <div className="ps-rec-tiles">
            {lines.map((l) => (
              <div key={l.key} className="ps-panel ps-rec-tile">
                <span className="ps-eyebrow ps-rec-eyebrow">{l.sportName} · {l.groupLabel} {l.category}</span>
                <span className="ps-rec-tile-v">{l.record!.text}</span>
                <span className="ps-rec-tile-who">
                  <span className="ps-rec-coin" aria-hidden="true">{initials(l.record!.name)}</span>
                  {l.record!.name}
                  <span className="ps-rec-since">{l.record!.year === thisYear ? `new · ${l.record!.year}` : `since ${l.record!.year}`}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
