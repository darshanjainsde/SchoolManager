import { renderLetter, safeHex, platformBrand, EMAIL_TEMPLATES, type EmailBrand, type Letter } from './letterhead';

const SCHOOL: EmailBrand = {
  schoolName: 'Raffles Primary School',
  logoUrl: null,
  accent: '#1c4ea0',
  template: 'CLASSIC',
  footerLines: ['14 Lake Road, Indiranagar', 'office@rafflesprimary.in'],
  siteHost: 'raffles.sckools.com',
  showPlatformCredit: true,
};

const LETTER: Letter = {
  title: 'Welcome to Raffles Primary School',
  intro: 'Your account is ready.',
  rows: [{ label: 'Sign-in name', value: 'RAF-00301' }],
  cta: { label: 'Set your password', url: 'https://raffles.sckools.com/reset-password?token=abc' },
  note: 'Valid for 30 minutes.',
};

describe('letterhead', () => {
  it('puts the school — not the platform — on every template', () => {
    for (const template of EMAIL_TEMPLATES) {
      const { html, text } = renderLetter({ ...SCHOOL, template }, LETTER);
      expect(html).toContain('Raffles Primary School');
      expect(text).toContain('Raffles Primary School');
      // The accent must actually reach the markup, or the school's colour is
      // decorative in the settings screen and absent from the inbox.
      expect(html.toLowerCase()).toContain('#1c4ea0');
    }
  });

  it('renders initials as the crest when a school has uploaded no logo', () => {
    const { html } = renderLetter(SCHOOL, LETTER);
    expect(html).toContain('>\n        RP\n      <');
    expect(html).not.toContain('<img');
  });

  it('uses the logo when there is one', () => {
    const { html } = renderLetter({ ...SCHOOL, logoUrl: 'https://cdn.example.com/crest.png' }, LETTER);
    expect(html).toContain('src="https://cdn.example.com/crest.png"');
  });

  it('carries the CTA and every row into both html and text parts', () => {
    const { html, text } = renderLetter(SCHOOL, LETTER);
    expect(html).toContain('https://raffles.sckools.com/reset-password?token=abc');
    expect(text).toContain('https://raffles.sckools.com/reset-password?token=abc');
    expect(html).toContain('RAF-00301');
    expect(text).toContain('Sign-in name: RAF-00301');
    // A text part that silently loses the action is how recipients get an
    // email they cannot act on.
    expect(text).toContain('Set your password');
  });

  it('escapes school-authored text so a name can never inject markup', () => {
    const { html } = renderLetter(
      { ...SCHOOL, schoolName: 'Green & "Valley" <b>School</b>' },
      { title: '<script>alert(1)</script>', body: 'A & B < C' },
    );
    expect(html).toContain('Green &amp; &quot;Valley&quot; &lt;b&gt;School&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('shows the platform credit only while the platform is doing the sending', () => {
    expect(renderLetter(SCHOOL, LETTER).html).toContain('by Sckools');
    expect(renderLetter({ ...SCHOOL, showPlatformCredit: false }, LETTER).html).not.toContain('by Sckools');
  });

  it('never emits an unparseable colour, however a school stored it', () => {
    // The stored value lands inside a style attribute, so anything that is not
    // a colour must be neutralised rather than passed through.
    expect(safeHex('red; background:url(javascript:alert(1))')).toBe('#4f46e5');
    expect(safeHex('#abc')).toBe('#aabbcc');
    expect(safeHex(null)).toBe('#4f46e5');
    const { html } = renderLetter({ ...SCHOOL, accent: 'javascript:alert(1)' }, LETTER);
    expect(html).not.toContain('javascript:');
  });

  it('picks readable text on a pale accent instead of white-on-white', () => {
    const pale = renderLetter({ ...SCHOOL, accent: '#fdf3d8', template: 'BANNER' }, LETTER).html;
    // The school name sits ON the accent in BANNER; on a near-white brand it
    // must switch to ink or the header is invisible.
    expect(pale).toContain('#20243a');
  });

  it('still names a school when the platform brand is used as a fallback', () => {
    const { html } = renderLetter(platformBrand(), LETTER);
    expect(html).toContain('Sckools');
  });
});
