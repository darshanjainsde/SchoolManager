/**
 * One-shot brand asset generator. Run `pnpm --filter @skoolos/web icons`
 * after changing scripts/icon-source.svg or scripts/og-source.svg, then
 * commit the regenerated files in public/. Not part of the Vercel build.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const iconSvg = await readFile(path.join(here, 'icon-source.svg'));
const ogSvg = await readFile(path.join(here, 'og-source.svg'));

async function png(svg, size, file, { width, height } = {}) {
  const buf = await sharp(svg, { density: 300 })
    .resize(width ?? size, height ?? size)
    .png()
    .toBuffer();
  await writeFile(path.join(pub, file), buf);
  console.log(`wrote public/${file} (${buf.length} bytes)`);
  return buf;
}

// ICO container with one embedded PNG (valid since Vista; fine for Google/browsers).
function pngToIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12); // data offset: 6 + 16
  return Buffer.concat([header, entry, pngBuf]);
}

const png48 = await png(iconSvg, 48, 'icon-48.png');
await png(iconSvg, 192, 'icon-192.png');
await png(iconSvg, 512, 'icon-512.png');
await png(iconSvg, 180, 'apple-touch-icon.png');
await writeFile(path.join(pub, 'favicon.ico'), pngToIco(png48, 48));
console.log('wrote public/favicon.ico');
await png(ogSvg, null, 'og.png', { width: 1200, height: 630 });
