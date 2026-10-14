import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The rule of this folder: an amount is never converted to a floating-point `number`.
// This test reads the source and fails if any of the usual ways to do that appears.
const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

const forbidden: [RegExp, string][] = [
  [/\bparseFloat\b/, 'parseFloat'],
  [/\bparseInt\b/, 'parseInt'],
  [/\bNumber\b/, 'Number'],
  [/\bMath\./, 'Math.*'],
  [/\.toFixed\b/, '.toFixed'],
  [/\.toPrecision\b/, '.toPrecision'],
  [/\bparseNumber\b/, 'parseNumber'],
];

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the money module never goes through a floating-point number', () => {
  it('has source files to check', () => {
    expect(sources).toEqual(
      expect.arrayContaining(['amount.ts', 'format.ts', 'parse.ts', 'scales.ts']),
    );
  });

  it.each(sources)('%s contains none of the forbidden calls', (file) => {
    const code = withoutComments(readFileSync(join(here, file), 'utf8'));
    for (const [pattern, name] of forbidden) {
      expect(code, `${file} uses ${name}`).not.toMatch(pattern);
    }
  });
});
