import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  checkClientBundle,
  checkHtml,
  findSecret,
  secretForms,
  type OutputFile,
} from './build-checks';

const file = (path: string, text: string | Buffer): OutputFile => ({
  path,
  content: Buffer.isBuffer(text) ? text : Buffer.from(text),
});

const KEY = 'canary-0123456789abcdef0123456789abcdef';

describe('findSecret', () => {
  it('finds the key as it is', () => {
    expect(findSecret([file('a.js', `const k = "${KEY}";`)], KEY)).toEqual([
      { file: 'a.js', message: 'contains the API key (as it is)' },
    ]);
  });

  it('finds it in a source map, a stylesheet, a page, or a binary', () => {
    for (const path of ['a.js.map', 'a.css', 'index.html', 'font.woff2']) {
      expect(
        findSecret(
          [
            file(
              path,
              Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(KEY), Buffer.from([255])]),
            ),
          ],
          KEY,
        ),
        path,
      ).toHaveLength(1);
    }
  });

  it('finds it URL-encoded, in hexadecimal, and in base64 whatever its alignment', () => {
    const forms = [
      encodeURIComponent(`${KEY}!`).slice(0, 0) + encodeURIComponent(KEY),
      Buffer.from(KEY).toString('hex'),
      Buffer.from(KEY).toString('base64'),
      Buffer.from(` ${KEY}`).toString('base64'),
      Buffer.from(`ab${KEY}`).toString('base64'),
      Buffer.from(KEY).toString('base64url'),
    ];
    for (const form of forms)
      expect(findSecret([file('x.js', `a="${form}";`)], KEY).length, form).toBeGreaterThan(0);
  });

  it('finds a base64 secret wherever it sits in a longer encoded blob (property)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 40 }),
        fc.uint8Array({ maxLength: 40 }),
        fc.stringMatching(/^[A-Za-z0-9]{16,40}$/),
        (before, after, secret) => {
          const blob = Buffer.concat([
            Buffer.from(before),
            Buffer.from(secret),
            Buffer.from(after),
          ]).toString('base64');
          expect(findSecret([file('x.js', blob)], secret).length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('does not report a file that does not have it', () => {
    expect(findSecret([file('a.js', 'const nothing = 1;'), file('b.css', 'body{}')], KEY)).toEqual(
      [],
    );
  });

  it('does not take a different key for it', () => {
    expect(findSecret([file('a.js', `"${KEY.slice(0, -1)}x"`)], KEY)).toEqual([]);
  });

  it('reports each file that has it', () => {
    const found = findSecret([file('a.js', KEY), file('b.js', 'no'), file('c.js.map', KEY)], KEY);
    expect(found.map((p) => p.file)).toEqual(['a.js', 'c.js.map']);
  });

  it('looks for forms that are long enough to mean something', () => {
    for (const { needle } of secretForms(KEY)) expect(needle.length).toBeGreaterThanOrEqual(8);
  });
});

describe('checkHtml (what the Content Security Policy would block)', () => {
  const good = `<!doctype html><html><head><meta charset="UTF-8"><script src="/theme.js"></script><script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css"></head><body><div id="root"></div></body></html>`;

  it('accepts the page as the build makes it', () => {
    expect(checkHtml(good, 'index.html')).toEqual([]);
  });

  it.each([
    ['an inline script', '<script>alert(1)</script>', /inline script/],
    ['an inline module', '<script type="module">import "/x.js"</script>', /inline script/],
    ['an empty inline script', '<script></script>', /inline script/],
    ['a script with src and code', '<script src="/a.js">alert(1)</script>', /also has code/],
    ['an import map', '<script type="importmap" src="/m.json"></script>', /import map/],
    ['an inline style element', '<style>body{color:red}</style>', /inline <style>/],
    ['a style attribute', '<div style="color:red"></div>', /style=/],
    ['an event handler', '<body onload="init()">', /event handler/],
    ['an onclick', '<button onclick = "go()">x</button>', /event handler/],
    ['a javascript: address', '<a href="javascript:void(0)">x</a>', /javascript:/],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=/x">', /meta refresh/],
    [
      'a script from another site',
      '<script src="https://cdn.example/x.js"></script>',
      /another origin/,
    ],
    ['a protocol-relative script', '<script src="//cdn.example/x.js"></script>', /another origin/],
    [
      'a stylesheet from another site',
      '<link rel="stylesheet" href="http://fonts.example/x.css">',
      /another origin/,
    ],
    [
      'a data: script',
      '<script src="data:text/javascript,alert(1)"></script>',
      /another origin or scheme/,
    ],
    ['a form posting elsewhere', '<form action="https://evil.example/"></form>', /another origin/],
  ])('refuses %s', (_name, markup, message) => {
    const problems = checkHtml(`${good}${markup}`, 'index.html');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((p) => p.message).join('; ')).toMatch(message);
    expect(problems.every((p) => p.file === 'index.html')).toBe(true);
  });

  it('is not fooled by upper case or by line breaks inside the tag', () => {
    expect(checkHtml('<SCRIPT>x()</SCRIPT>', 'i.html')).toHaveLength(1);
    expect(checkHtml('<script\n  type="module"\n>x()</script\n>', 'i.html')).toHaveLength(1);
    expect(checkHtml('<DIV STYLE="a:b"></DIV>', 'i.html')).toHaveLength(1);
  });

  it('does not mistake words that contain "on" or "style" for attributes', () => {
    expect(
      checkHtml(
        '<meta name="description" content="a stylesheet-free, on-page text"><p data-reason="x">y</p>',
        'i.html',
      ),
    ).toEqual([]);
  });
});

describe('checkClientBundle (the browser must not know how to authenticate)', () => {
  const bundle = (text: string) => [file('assets/app.js', text)];

  it('accepts code that does not build a credential', () => {
    expect(
      checkClientBundle(bundle('fetch("/api/v1/accounts",{headers:{Accept:"application/json"}})')),
    ).toEqual([]);
  });

  it.each([
    ['a Bearer credential', 'headers.set("Authorization","Bearer "+key)'],
    ['a Bearer credential in a template', 'const h=`Bearer ${k}`'],
    ['the Authorization header by name', 'headers.set("authorization", token)'],
    ['the Authorization header in single quotes', "h['Authorization']=x"],
    ['a VITE_ variable that looks like a key', 'import.meta.env.VITE_LEDGERD_API_KEY'],
  ])('refuses code that has %s', (_name, code) => {
    expect(checkClientBundle(bundle(code)).length).toBeGreaterThan(0);
  });

  it('looks at scripts and pages, and leaves images and fonts alone', () => {
    expect(checkClientBundle([file('a.mjs', 'Bearer x')]).length).toBe(1);
    expect(checkClientBundle([file('a.html', 'Bearer x')]).length).toBe(1);
    expect(checkClientBundle([file('a.woff2', 'Bearer x'), file('a.png', 'Bearer x')])).toEqual([]);
  });

  it('does not take ordinary words for it', () => {
    expect(checkClientBundle(bundle('"The console is not authorised to use the ledger"'))).toEqual(
      [],
    );
  });
});
