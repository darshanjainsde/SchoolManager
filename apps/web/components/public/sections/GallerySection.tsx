'use client';

import type { PublicSiteData } from '@/lib/public-api';

export default function GallerySection({
  gallery,
  schoolName,
}: {
  gallery: PublicSiteData['gallery'];
  schoolName: string;
}) {
  return (
    <section id="gallery" className="max-w-6xl mx-auto px-6 py-20">
      <div className="reveal">
        <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
          Gallery
        </div>
        <h2 className="ps-head text-4xl font-bold mt-3">Life at {schoolName}</h2>
      </div>
      {gallery.length === 0 ? (
        <div className="reveal mt-10 ps-card ps-soft rounded-3xl p-10 text-center">
          <div className="text-5xl">📷</div>
          <h3 className="ps-head font-bold text-lg mt-4">Photos coming soon</h3>
          <p className="text-sm text-slate-500 mt-1">Moments from campus life will appear here.</p>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
          {gallery.map((img, i) => (
            <div
              key={i}
              className="reveal group relative rounded-2xl overflow-hidden ps-card ps-soft"
              style={{ transitionDelay: `${i * 0.05}s` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.caption ?? `${schoolName} gallery ${i + 1}`}
                className="h-48 w-full object-cover transition duration-500 group-hover:scale-105"
              />
              {img.caption && (
                <>
                  <div className="absolute inset-0 bg-gradient-to-t from-[#14261d]/75 to-transparent opacity-0 group-hover:opacity-100 transition" />
                  <div className="absolute bottom-3 left-3 text-sm font-medium text-white opacity-0 group-hover:opacity-100 transition">
                    {img.caption}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
