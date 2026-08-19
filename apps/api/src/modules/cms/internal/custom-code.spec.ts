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
});
