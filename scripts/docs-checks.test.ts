import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkAdrs, checkReadme, type ReadmeFacts } from './docs-checks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const readme = read('README.md');
const packageJson = read('package.json');
const facts: ReadmeFacts = {
  screenshots: readdirSync(join(root, 'docs/screenshots')).filter((f) => f.endsWith('.png')),
  exists: (path) => existsSync(join(root, path)),
  npmScripts: new Set(Object.keys((JSON.parse(packageJson) as { scripts: object }).scripts)),
  makeTargets: new Set(
    [...read('Makefile').matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((m) => m[1] ?? ''),
  ),
  packageJson,
  compose: read('docker-compose.yml'),
  serverConfig: read('server/src/config.ts'),
};

const adrDir = join(root, 'docs/adr');
const adrs = Object.fromEntries(
  readdirSync(adrDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => [f, readFileSync(join(adrDir, f), 'utf8')]),
);
const index = adrs['README.md'] ?? '';

describe('the real documentation follows the rules', () => {
  it('README.md', () => {
    expect(checkReadme(readme, facts)).toEqual([]);
  });
  it('the decision records', () => {
    expect(checkAdrs(adrs, index)).toEqual([]);
  });
});

describe('checkReadme', () => {
  const messages = (text: string, f: ReadmeFacts = facts): string =>
    checkReadme(text, f)
      .map((p) => p.message)
      .join('\n');

  it.each([
    [
      'a missing section',
      readme.replace('## Limitations', '## Caveats'),
      /no "Limitations" section/,
    ],
    ['no diagram', readme.replace('```mermaid', '```text'), /no architecture diagram/],
    [
      'no explanation of the key',
      readme.replace('Why the key stays on the server', 'About the key'),
      /why the API key stays/,
    ],
    [
      'a page without a screenshot',
      readme.replaceAll('docs/screenshots/settings.png', 'docs/screenshots/overview.png'),
      /no screenshot named settings\.png/,
    ],
    [
      'a screenshot that does not exist',
      readme.replace('docs/screenshots/overview.png', 'docs/screenshots/gone.png'),
      /gone\.png, which does not exist/,
    ],
    [
      'a link that does not resolve',
      readme.replace('(docs/adr/README.md)', '(docs/adr/missing.md)'),
      /links to docs\/adr\/missing\.md/,
    ],
    [
      'a different ledgerd version',
      readme.replaceAll('ledgerd 0.2.0', 'ledgerd 0.1.0'),
      /does not say it requires ledgerd 0\.2\.0/,
    ],
    [
      'no word on updating the types',
      readme.replaceAll('npm run generate:api', 'npm run something'),
      /how to update the generated API types/,
    ],
    [
      'a command that does not exist',
      `${readme}\n\`npm run nope\`\n`,
      /npm run nope, which does not exist/,
    ],
    [
      'a make target that does not exist',
      `${readme}\n\`make nope\`\n`,
      /make nope, which does not exist/,
    ],
    [
      'an undocumented variable',
      readme.replace('`CONSOLE_STATIC_DIR`', '`SOMETHING_ELSE`'),
      /does not document the variable CONSOLE_STATIC_DIR/,
    ],
  ])('rejects %s', (_name, text, expected) => {
    expect(text).not.toBe(readme);
    expect(messages(text)).toMatch(expected);
  });

  it('rejects an <img> of a screenshot that does not exist (a link check cannot see it)', () => {
    const text = readme.replace('mobile-new-transaction.png', 'gone-on-a-phone.png');
    expect(text).not.toBe(readme);
    expect(messages(text)).toMatch(/gone-on-a-phone\.png, which does not exist/);
  });

  it('rejects a screenshot nobody shows', () => {
    expect(
      messages(readme, { ...facts, screenshots: [...facts.screenshots, 'orphan.png'] }),
    ).toMatch(/orphan\.png is not used/);
  });

  it('rejects compose files that run another ledgerd version', () => {
    const other = facts.compose.replace(/(ghcr\.io\/cmdevrg\/ledgerd-postgres:)0\.2\.0/, '$10.1.0');
    expect(other).not.toBe(facts.compose);
    expect(messages(readme, { ...facts, compose: other })).toMatch(
      /does not run ledgerd 0\.2\.0 everywhere/,
    );
  });

  it('says so when the version cannot be found', () => {
    expect(messages(readme, { ...facts, packageJson: '{"scripts":{}}' })).toMatch(
      /cannot find the ledgerd version/,
    );
  });

  it('does not mind links to the web, to anchors, or to a file with an anchor', () => {
    const extra = `${readme}\n[a](https://example.com/x) [b](#quick-start) [c](docs/adr/README.md#top)\n`;
    expect(messages(extra)).toBe('');
  });
});

describe('checkAdrs', () => {
  const messages = (files: Record<string, string>, idx = index): string =>
    checkAdrs(files, idx)
      .map((p) => `${p.file}: ${p.message}`)
      .join('\n');
  const first = Object.keys(adrs).find((f) => f.startsWith('0001')) ?? '';

  it('rejects a record missing from the index', () => {
    expect(messages(adrs, index.replace(`](${first})`, '](x)'))).toContain(
      'is not listed in the index',
    );
  });
  it('rejects an index entry without a file', () => {
    const rest = Object.fromEntries(Object.entries(adrs).filter(([name]) => name !== first));
    expect(messages(rest)).toContain(`the index links to ${first}, which does not exist`);
  });
  it.each(['Status:', '## Context', '## Decision', '## Consequences'])(
    'requires "%s" in a record',
    (section) => {
      const broken = { ...adrs, [first]: (adrs[first] ?? '').replace(section, 'xxx') };
      expect(messages(broken)).toContain(`has no "${section}"`);
    },
  );
  it('requires the heading of a record', () => {
    const broken = { ...adrs, [first]: (adrs[first] ?? '').replace(/^# \d{4}\. /, '# ') };
    expect(messages(broken)).toContain('has no "# NNNN. Title" heading');
  });
  it.each([
    ['API key', /why the API key/],
    ['Money', /the money-handling rule/],
    ['generated', /generated API types/],
    ['Failure Lab', /the Failure Lab is tested/],
  ])('requires a record about %s', (word, expected) => {
    const broken = Object.fromEntries(
      Object.entries(adrs).map(([name, text]) => [
        name,
        text.replace(/^(# .+)$/m, (h) =>
          h.replaceAll(word, 'x').replaceAll(word.toLowerCase(), 'x'),
        ),
      ]),
    );
    expect(messages(broken)).toMatch(expected);
  });
});
