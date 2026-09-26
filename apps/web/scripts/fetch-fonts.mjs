// Run from apps/web: node scripts/fetch-fonts.mjs — refreshes assets/fonts/*.woff2.
// Pulls the LATIN woff2 for every family the site offers, once, into the repo.
// next/font/google fetched these at BUILD time from fonts.googleapis.com; when
// that request hiccups the whole deploy fails ("Cannot read properties of null").
import { writeFileSync, mkdirSync } from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const FAMILIES = [
  ['Inter', 'inter', [400, 500, 600, 700]],
  ['Fraunces', 'fraunces', [400, 700]],
  ['Poppins', 'poppins', [400, 500, 600, 700]],
  ['Nunito', 'nunito', [400, 600, 700, 800]],
  ['Playfair Display', 'playfair', [400, 700]],
  ['Space Grotesk', 'space-grotesk', [400, 500, 700]],
  ['Montserrat', 'montserrat', [400, 600, 700]],
  ['Lora', 'lora', [400, 600, 700]],
];
const get = async (u, kind = 'text') => {
  // Google's CDN hiccups; that hiccup is exactly why these files live in the
  // repo now, so the one script that talks to it retries.
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(String(r.status));
      return kind === 'text' ? await r.text() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 4) throw e; await new Promise((res) => setTimeout(res, 800 * (i + 1))); }
  }
};

const out = 'assets/fonts';
mkdirSync(out, { recursive: true });
const report = [];
for (const [family, slug, weights] of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights.join(';')}&display=swap`;
  const css = await get(url);
  // Blocks are emitted per unicode-range; the latin one contains U+0000-00FF.
  const blocks = css.split('@font-face').slice(1);
  for (const w of weights) {
    const block = blocks.find((b) => new RegExp(`font-weight:\\s*${w}\\s*;`).test(b) && /unicode-range:[^;]*U\+0000-00FF/.test(b));
    if (!block) throw new Error(`${family} ${w}: no latin block`);
    const src = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!src) throw new Error(`${family} ${w}: no woff2`);
    const buf = await get(src, 'buf');
    const file = `${out}/${slug}-${w}.woff2`;
    writeFileSync(file, buf);
    report.push(`${file} ${(buf.length / 1024).toFixed(1)}KB`);
  }
}
console.log(report.join('\n'));
console.log('total', report.length, 'files');
