/**
 * One-shot blog hero-art generator. Run `pnpm --filter @skoolos/web blog-art`
 * after changing any scripts/blog-art/*.svg, then commit the regenerated
 * PNGs in public/blog/. Not part of the Vercel build.
 */
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const artDir = path.join(here, 'blog-art');
const outDir = path.join(here, '..', 'public', 'blog');

const sources = ['teaching-strategies', 'study-science', 'parents-guide'];

await mkdir(outDir, { recursive: true });

for (const name of sources) {
  const svg = await readFile(path.join(artDir, `${name}.svg`));
  const buf = await sharp(svg, { density: 300 })
    .resize(1600, 900)
    .png()
    .toBuffer();
  await writeFile(path.join(outDir, `${name}.png`), buf);
  console.log(`wrote public/blog/${name}.png (${buf.length} bytes)`);
}
