/**
 * Letterhead — one branded wrapper every school email is rendered through.
 *
 * Before this file each composer hand-wrote its own <div> with the same
 * hard-coded teal, so a parent's inbox showed a generic plain block that named
 * the school only in prose. Now every message is a `Letter` (title, intro,
 * rows, cta…) and the school's own crest, colour and footer are painted around
 * it here. A school that has configured NOTHING still gets its name, logo and
 * theme colour — those default from the profile it already filled in for its
 * website — which is the whole point: branded by default, configurable after.
 *
 * EMAIL-SAFE RULES (why this looks like 2004 HTML): Outlook renders with Word,
 * Gmail strips <style> blocks and unknown properties, and many clients ignore
 * flexbox/grid entirely. So: nested tables for layout, every style inlined,
 * a 600px shell, a table-based ("bulletproof") button rather than a styled <a>
 * with padding, and no CSS that must cascade. Colours are written literally —
 * custom properties do not survive most clients.
 */

/** Escapes a value for interpolation into an HTML email body. */
export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The three letterheads a school can choose between. All carry the same
 * information; they differ in how loudly the school's identity is stated.
 */
export const EMAIL_TEMPLATES = ['CLASSIC', 'BANNER', 'MINIMAL'] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export interface EmailBrand {
  /** Always present — a letter never goes out unnamed. */
  schoolName: string;
  logoUrl: string | null;
  /** Hex, `#rrggbb`. Defaults to the school's website brand colour. */
  accent: string;
  template: EmailTemplate;
  /** Address / phone / office email — rendered as the footer's small print. */
  footerLines: string[];
  /** The school's own web address, shown under the name. */
  siteHost: string | null;
  /**
   * True while the school still sends through the platform's mailbox. The
   * footer then says so, honestly. Once a school sends from its own verified
   * address the line disappears — the mail is entirely theirs.
   */
  showPlatformCredit: boolean;
}

export interface LetterRow {
  label: string;
  value: string;
}

export interface Letter {
  /** The <h1> of the message. */
  title: string;
  /** Inbox preview text. Falls back to the intro. */
  preheader?: string;
  /** Opening paragraph. */
  intro?: string;
  /** Label/value detail table (subject, date, marks…). */
  rows?: LetterRow[];
  /** Free prose block, newlines preserved (announcement bodies). */
  body?: string;
  /** Someone else's words, set apart (a teacher's diary remark). */
  quote?: string;
  cta?: { label: string; url: string };
  /** Small print under the action — validity, what to do if unexpected. */
  note?: string;
  /**
   * Colours the title and the quote rule. `alert` is for things a parent must
   * not skim past (a remark, an absence); `default` for everything else.
   */
  tone?: 'default' | 'alert';
}

const FALLBACK_ACCENT = '#4f46e5';
const INK = '#20243a';
const INK_2 = '#4a4f68';
const INK_3 = '#8b90a5';
const PAPER = '#f1f0ee';
const CARD = '#ffffff';
const HAIRLINE = '#e9e7e1';
const ALERT = '#b3261e';

/** `#abc` / `#aabbcc` → `{r,g,b}`; anything unparseable falls back to the brand indigo. */
function toRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return toRgb(FALLBACK_ACCENT);
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Normalised to `#rrggbb`, so a school's stored value can never inject CSS. */
export function safeHex(hex: string | null | undefined): string {
  if (!hex) return FALLBACK_ACCENT;
  const { r, g, b } = toRgb(hex);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, used to decide white-on-accent vs ink-on-accent. */
function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Readable text colour ON the accent — a pale school colour must not get white text. */
function onAccent(accent: string): string {
  return luminance(accent) > 0.55 ? INK : '#ffffff';
}

/** The accent darkened toward ink, for headings where the raw colour is too light to read. */
function accentInk(accent: string): string {
  const { r, g, b } = toRgb(accent);
  if (luminance(accent) <= 0.45) return safeHex(accent);
  const mix = (c: number) => Math.round(c * 0.55);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A very pale wash of the accent, for the quote block and table zebra. */
function accentTint(accent: string): string {
  const { r, g, b } = toRgb(accent);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.9);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Initials for the crest when a school has uploaded no logo. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const letters = words.slice(0, 2).map((w) => w[0]).join('');
  return (letters || name.trim()[0] || 'S').toUpperCase();
}

/**
 * The crest: the school's logo when it has one, otherwise its initials on the
 * accent. Rendered as a table cell rather than a styled div — Outlook drops
 * border-radius and background on divs often enough to matter.
 */
function crest(brand: EmailBrand, size: number): string {
  if (brand.logoUrl) {
    return `<img src="${escapeHtml(brand.logoUrl)}" width="${size}" height="${size}" alt="${escapeHtml(brand.schoolName)}"
      style="display:block;width:${size}px;height:${size}px;border-radius:8px;object-fit:cover;border:0;outline:none;text-decoration:none">`;
  }
  const bg = safeHex(brand.accent);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
      <tr><td width="${size}" height="${size}" align="center" valign="middle"
        style="width:${size}px;height:${size}px;background:${bg};border-radius:8px;color:${onAccent(bg)};
        font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:${Math.round(size * 0.38)}px;letter-spacing:.5px">
        ${escapeHtml(initials(brand.schoolName))}
      </td></tr></table>`;
}

/** Bulletproof CTA — a table with a background, not a padded anchor. */
function ctaButton(cta: { label: string; url: string }, accent: string): string {
  const bg = safeHex(accent);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px">
      <tr><td align="center" bgcolor="${bg}" style="border-radius:9px">
        <a href="${escapeHtml(cta.url)}"
           style="display:inline-block;padding:12px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;
                  font-weight:bold;color:${onAccent(bg)};text-decoration:none;border-radius:9px">
          ${escapeHtml(cta.label)}
        </a>
      </td></tr></table>`;
}

function rowsTable(rows: LetterRow[], accent: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
      style="border-collapse:collapse;margin:14px 0;background:${accentTint(accent)};border-radius:9px">
      ${rows
        .map(
          (r) => `<tr>
        <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK_3};white-space:nowrap">${escapeHtml(r.label)}</td>
        <td style="padding:9px 14px 9px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};font-weight:bold">${escapeHtml(r.value)}</td>
      </tr>`,
        )
        .join('')}
    </table>`;
}

/** The school identity block, which is what differs between the three templates. */
function header(brand: EmailBrand): string {
  const accent = safeHex(brand.accent);
  const name = escapeHtml(brand.schoolName);
  const host = brand.siteHost ? escapeHtml(brand.siteHost) : '';

  if (brand.template === 'BANNER') {
    // The loudest: the school's colour fills the head and its name is reversed out of it.
    return `<tr><td bgcolor="${accent}" style="background:${accent};padding:22px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="46" valign="middle" style="padding-right:12px">${crest(brand, 46)}</td>
            <td valign="middle">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;color:${onAccent(accent)};line-height:1.25">${name}</div>
              ${host ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${onAccent(accent)};opacity:.75;padding-top:2px">${host}</div>` : ''}
            </td>
          </tr>
        </table>
      </td></tr>`;
  }

  if (brand.template === 'MINIMAL') {
    // The quietest: a hairline rule, small logo, name in plain type. For schools
    // whose letters should read like a note from the office, not a broadcast.
    return `<tr><td style="padding:24px 28px 12px;border-bottom:1px solid ${HAIRLINE}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="28" valign="middle" style="padding-right:10px">${crest(brand, 28)}</td>
            <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${INK};letter-spacing:.2px">${name}</td>
          </tr>
        </table>
      </td></tr>`;
  }

  // CLASSIC (default): an accent band above a white identity row — the school's
  // colour is present without shouting, and the crest sits on paper where a
  // photographic logo reads best.
  return `<tr><td style="padding:0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td bgcolor="${accent}" height="6" style="background:${accent};height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
        <tr><td style="padding:20px 28px 8px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="40" valign="middle" style="padding-right:12px">${crest(brand, 40)}</td>
              <td valign="middle">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:bold;color:${INK};line-height:1.3">${name}</div>
                ${host ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${INK_3};padding-top:2px">${host}</div>` : ''}
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>`;
}

function footer(brand: EmailBrand): string {
  const lines = brand.footerLines.filter((l) => l.trim()).map((l) => escapeHtml(l));
  const credit = brand.showPlatformCredit
    ? `<div style="padding-top:6px;color:${INK_3}">Sent for ${escapeHtml(brand.schoolName)} by Sckools</div>`
    : '';
  return `<tr><td style="padding:16px 28px 22px;border-top:1px solid ${HAIRLINE};
      font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.55;color:${INK_3}">
      <div style="color:${INK_2};font-weight:bold">${escapeHtml(brand.schoolName)}</div>
      ${lines.length ? `<div>${lines.join(' &middot; ')}</div>` : ''}
      ${credit}
    </td></tr>`;
}

/**
 * Renders a letter to the HTML a client shows and the plain text a client
 * without HTML (or a screen reader in text mode) reads. Both are always
 * produced from the SAME letter — a text part that drifts from the HTML is how
 * recipients end up with an empty-looking email.
 */
export function renderLetter(brand: EmailBrand, letter: Letter): { html: string; text: string } {
  const accent = safeHex(brand.accent);
  const titleColor = letter.tone === 'alert' ? ALERT : accentInk(accent);
  const preheader = letter.preheader ?? letter.intro ?? letter.title;

  const parts: string[] = [];
  parts.push(
    `<h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.3;color:${titleColor};font-weight:bold">${escapeHtml(letter.title)}</h1>`,
  );
  if (letter.intro) {
    parts.push(
      `<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:${INK_2}">${escapeHtml(letter.intro)}</p>`,
    );
  }
  if (letter.rows?.length) parts.push(rowsTable(letter.rows, accent));
  if (letter.body) {
    parts.push(
      `<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:${INK_2};white-space:pre-wrap">${escapeHtml(letter.body)}</p>`,
    );
  }
  if (letter.quote) {
    const rule = letter.tone === 'alert' ? ALERT : accent;
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0">
        <tr><td style="padding:12px 16px;border-left:4px solid ${rule};background:${letter.tone === 'alert' ? '#fdf2f1' : accentTint(accent)};
          font-family:Georgia,'Times New Roman',serif;font-size:14.5px;line-height:1.6;color:${INK};white-space:pre-wrap">${escapeHtml(letter.quote)}</td></tr>
      </table>`,
    );
  }
  if (letter.cta) parts.push(ctaButton(letter.cta, accent));
  if (letter.note) {
    parts.push(
      `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:${INK_3}">${escapeHtml(letter.note)}</p>`,
    );
  }

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(letter.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${PAPER}">${escapeHtml(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER}">
  <tr><td align="center" style="padding:22px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
      style="width:600px;max-width:100%;background:${CARD};border-radius:12px;border:1px solid ${HAIRLINE};overflow:hidden">
      ${header(brand)}
      <tr><td style="padding:14px 28px 22px">${parts.join('\n')}</td></tr>
      ${footer(brand)}
    </table>
  </td></tr>
</table>
</body></html>`;

  // Plain-text twin, built from the same letter.
  const t: string[] = [brand.schoolName, '='.repeat(Math.min(brand.schoolName.length, 40)), '', letter.title, ''];
  if (letter.intro) t.push(letter.intro, '');
  if (letter.rows?.length) {
    letter.rows.forEach((r) => t.push(`${r.label}: ${r.value}`));
    t.push('');
  }
  if (letter.body) t.push(letter.body, '');
  if (letter.quote) t.push(`"${letter.quote}"`, '');
  if (letter.cta) t.push(`${letter.cta.label}: ${letter.cta.url}`, '');
  if (letter.note) t.push(letter.note, '');
  const foot = brand.footerLines.filter((l) => l.trim());
  if (foot.length) t.push('—', ...foot);
  if (brand.showPlatformCredit) t.push(`Sent for ${brand.schoolName} by Sckools`);

  return { html, text: t.join('\n').trim() };
}

/** The brand used when no school is in play (owner/marketing mail) or none resolves. */
export function platformBrand(): EmailBrand {
  return {
    schoolName: 'Sckools',
    logoUrl: null,
    accent: FALLBACK_ACCENT,
    template: 'CLASSIC',
    footerLines: [],
    siteHost: 'sckools.com',
    showPlatformCredit: false,
  };
}
