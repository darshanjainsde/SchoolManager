'use client';

import type { PublicSiteData } from '@/lib/public-api';
import { formatEventDate, safeHttpUrl } from '../site-utils';

export default function EventsSection({
  events,
  timezone,
}: {
  events: PublicSiteData['events'];
  timezone: string;
}) {
  return (
    <section id="events" className="ps-brandgrad text-white">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="reveal">
          <div className="text-sm font-semibold uppercase tracking-widest text-white/80">Connect · Events</div>
          <h2 className="ps-head text-4xl font-bold mt-3 text-white">What&rsquo;s on across our network</h2>
          <p className="mt-2 text-white/80 max-w-xl">
            Events from every school in the network — one shared calendar for the whole community.
          </p>
        </div>
        {events.length === 0 ? (
          <div className="reveal mt-10 bg-white/10 backdrop-blur rounded-3xl border border-white/15 p-10 text-center">
            <div className="text-5xl">📅</div>
            <h3 className="ps-head font-bold text-lg mt-4 text-white">No upcoming events right now</h3>
            <p className="text-sm text-white/80 mt-1">Check back soon — new events land here as they&rsquo;re announced.</p>
          </div>
        ) : (
          <div className="mt-10 grid md:grid-cols-3 gap-5">
            {events.map((e, i) => {
              const coverSrc = safeHttpUrl(e.coverUrl);
              const metaLine = [formatEventDate(e.startAt, timezone), e.venue ? `· ${e.venue}` : null]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={e.id}
                  className="reveal ps-lift bg-white/10 backdrop-blur rounded-3xl overflow-hidden border border-white/15"
                  style={{ transitionDelay: `${i * 0.07}s` }}
                >
                  {coverSrc ? (
                    <div className="h-40 bg-cover bg-center" style={{ backgroundImage: `url('${coverSrc}')` }} />
                  ) : (
                    <div className="h-40 bg-white/10 grid place-items-center text-5xl">📅</div>
                  )}
                  <div className="p-5">
                    {e.isHost ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded ps-accentbg" style={{ color: 'var(--ink)' }}>
                        Our School
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/25 text-white">
                        Network · {e.originSchoolName ?? 'Network'}
                      </span>
                    )}
                    <h3 className="ps-head font-bold text-lg mt-3 leading-snug text-white">{e.title}</h3>
                    <div className="text-sm text-white/80 mt-1">{metaLine}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
