import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE STYLESHEET THE BROWSER ACTUALLY GETS.
 *
 * Every audit page used to load `app/sk-theme.css` alone. That is the theme,
 * not the stylesheet: every Tailwind utility the console is built from —
 * `overflow-x-auto`, `grid`, `flex`, the gaps — was simply absent. A table
 * that scrolls inside its own box in the app overflowed the page here, and a
 * screen built on `.sk-*` classes passed while one built on utilities was
 * measured against CSS it never ships with.
 *
 * Measuring the real components in a fake stylesheet is measuring nothing, so
 * this reads the built CSS too and refuses to return without it.
 */
export function appCss(): string {
  const theme = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');
  const dir = resolve(process.cwd(), '.next/static/css');
  if (!existsSync(dir)) {
    throw new Error('audit: .next/static/css is missing — run `next build` before the audit, or it measures the theme alone.');
  }
  const built = readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(resolve(dir, f), 'utf8'))
    .join('\n');
  const css = `${theme}\n${built}`;
  // A stale build would quietly take the utilities away again and every
  // finding would be an artefact. One canary is enough to notice.
  if (!/overflow-x:\s*auto/.test(css)) {
    throw new Error('audit: the built CSS has no utilities — `next build` is stale.');
  }
  return css;
}
