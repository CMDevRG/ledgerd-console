import { describe, expect, it } from 'vitest';

import { checkTraceability, parseCriteria, parseMatrix, type Facts } from './traceability';

const REQUIREMENTS = `# Requirements

### Requirement 1: One

#### Acceptance Criteria

1. The first SHALL hold.
2. The second SHALL hold.

### Requirement 2: Two

**User Story:** As a user.

#### Acceptance Criteria

1. Only one.
   continued on a line that starts with spaces.

## Decisions I need from you

1. Not a criterion.
`;

const facts: Facts = {
  tests: [
    { file: 'src/a.test.ts', name: 'parse > rejects zero' },
    { file: 'src/a.test.ts', name: 'parse > accepts one' },
    { file: 'e2e/b.spec.ts', name: 'shows the page' },
  ],
  npmScripts: new Set(['lint', 'check:build']),
  makeTargets: new Set(['smoke']),
};

const MATRIX = `| Criterion | Verified by |
|---|---|
| 1.1 first | \`src/a.test.ts › rejects zero\`, \`npm run lint\` |
| 1.2 second | \`e2e/b.spec.ts\` |
| 2.1 only | \`make smoke\`; Not automated: needs a person |
`;

const problems = (matrix: string, options = {}): string[] =>
  checkTraceability(REQUIREMENTS, matrix, facts, options).map((p) => p.message);

describe('parseCriteria', () => {
  it('numbers the criteria of each requirement, and only those', () => {
    expect(parseCriteria(REQUIREMENTS)).toEqual(['1.1', '1.2', '2.1']);
  });
  it('finds the criteria of the real requirements document', async () => {
    const { readFileSync } = await import('node:fs');
    const ids = parseCriteria(readFileSync('.kiro/specs/console/requirements.md', 'utf8'));
    expect(ids).toContain('2.6');
    expect(ids).toContain('18.4');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseMatrix', () => {
  it('reads the id, the text and the references of each row', () => {
    const rows = parseMatrix(MATRIX);
    expect(rows.map((r) => r.id)).toEqual(['1.1', '1.2', '2.1']);
    expect(rows[0]).toMatchObject({ text: 'first', line: 3 });
    expect(rows[0]?.references).toEqual([
      { kind: 'test', file: 'src/a.test.ts', fragment: 'rejects zero' },
      { kind: 'npm', script: 'lint' },
    ]);
    expect(rows[1]?.references).toEqual([
      { kind: 'test', file: 'e2e/b.spec.ts', fragment: undefined },
    ]);
    expect(rows[2]?.references).toEqual([
      { kind: 'make', target: 'smoke' },
      { kind: 'not-automated', reason: 'needs a person' },
    ]);
  });
  it('ignores backticked words that are not references', () => {
    const [row] = parseMatrix('| 1.1 uses `Number` | `npm run lint` and `parseFloat` |');
    expect(row?.references).toEqual([{ kind: 'npm', script: 'lint' }]);
  });
  it('ignores lines that are not criterion rows', () => {
    expect(parseMatrix('## R1\n\n| Criterion | Verified by |\n|---|---|\nprose')).toEqual([]);
  });
});

describe('checkTraceability', () => {
  it('accepts a complete, true matrix', () => {
    expect(problems(MATRIX)).toEqual([]);
  });

  it.each([
    [
      'a test file that does not exist',
      MATRIX.replace('src/a.test.ts', 'src/gone.test.ts'),
      /src\/gone\.test\.ts has no tests/,
    ],
    [
      'a test name that does not exist',
      MATRIX.replace('rejects zero', 'rejects nothing'),
      /no test in src\/a\.test\.ts has "rejects nothing"/,
    ],
    [
      'an npm script that does not exist',
      MATRIX.replace('npm run lint', 'npm run nope'),
      /no script "nope"/,
    ],
    [
      'a make target that does not exist',
      MATRIX.replace('make smoke', 'make nope'),
      /no target "nope"/,
    ],
    [
      'a criterion that requirements.md does not have',
      `${MATRIX}| 1.3 third | \`npm run lint\` |\n`,
      /1\.3 \(line 6\): requirements\.md has no such criterion/,
    ],
    [
      'a criterion listed twice',
      `${MATRIX}| 1.1 again | \`npm run lint\` |\n`,
      /1\.1 \(line 6\): the criterion appears twice/,
    ],
    [
      'a row that names nothing',
      MATRIX.replace('`e2e/b.spec.ts`', 'see the tests'),
      /names nothing/,
    ],
    [
      'a criterion left out',
      MATRIX.replace(/\| 1\.2 .*\n/, ''),
      /1\.2: the criterion is not in the matrix/,
    ],
    ['"Not automated" without a reason', '| 1.1 x | Not automated: |\n', /without a reason/],
  ])('rejects %s', (_name, matrix, expected) => {
    expect(matrix).not.toBe(MATRIX);
    expect(problems(matrix).join('\n')).toMatch(expected);
  });

  it('with partial, does not require every criterion', () => {
    const one = '| 1.1 first | `npm run lint` |\n';
    expect(problems(one)).toEqual([
      '1.2: the criterion is not in the matrix',
      '2.1: the criterion is not in the matrix',
    ]);
    expect(problems(one, { partial: true })).toEqual([]);
  });

  it('with partial, still checks the rows that are there', () => {
    expect(problems('| 1.1 first | `npm run nope` |\n', { partial: true })).toHaveLength(1);
  });

  it('names the file in each problem', () => {
    const result = checkTraceability(REQUIREMENTS, '', facts, { file: 'x.md' });
    expect(result.every((p) => p.file === 'x.md')).toBe(true);
  });
});
