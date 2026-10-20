/*
 * The traceability matrix (docs/traceability.md) maps every acceptance criterion of
 * requirements.md to what verifies it. These are the pure rules that keep it honest (R16.7);
 * scripts/check-traceability.ts runs them against the real files and the real test lists.
 *
 * A row of the matrix looks like
 *
 *   | 5.1 no amount goes through a float | `src/money/money.test.ts › parseAmount` , `npm run lint` |
 *
 * and may cite, in backticks:
 *   - a test:   `path/to/file.test.ts › a part of the test's full name` (the part after "›" may be
 *               left out to cite every test of the file). The full name is the one the test runner
 *               lists: the names of the enclosing `describe` blocks and the test, joined by " > ".
 *   - a script: `npm run name` (must exist in package.json) or `make name` (must exist in the Makefile).
 *   - or say "Not automated: why", for a criterion no test can verify.
 */
import type { Problem } from './container-checks';

export interface ListedTest {
  /** Path from the repository root, with forward slashes. */
  file: string;
  /** Names of the enclosing blocks and of the test, joined by " > ". */
  name: string;
}

export type Reference =
  | { kind: 'test'; file: string; fragment: string | undefined }
  | { kind: 'npm'; script: string }
  | { kind: 'make'; target: string }
  | { kind: 'not-automated'; reason: string };

export interface Row {
  id: string;
  text: string;
  line: number;
  references: Reference[];
}

const TEST_FILE = /^[\w./@-]+\.(?:test|spec)\.tsx?$/;

/** The ids ("5.1") of every acceptance criterion in a requirements document. */
export function parseCriteria(requirements: string): string[] {
  const ids: string[] = [];
  let requirement: string | undefined;
  let inCriteria = false;
  for (const line of requirements.split('\n')) {
    const heading = /^### Requirement (\d+):/.exec(line);
    if (heading !== null) {
      requirement = heading[1];
      inCriteria = false;
      continue;
    }
    if (/^#{1,3} /.test(line)) inCriteria = false;
    if (line.startsWith('#### Acceptance Criteria')) inCriteria = true;
    const item = /^(\d+)\. /.exec(line);
    if (inCriteria && requirement !== undefined && item !== null) {
      ids.push(`${requirement}.${item[1] ?? ''}`);
    }
  }
  return ids;
}

function references(cell: string): Reference[] {
  const found: Reference[] = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    const token = (match[1] ?? '').trim();
    const [head = '', ...rest] = token.split(' › ');
    const npm = /^npm run ([\w:-]+)$/.exec(token);
    const make = /^make ([\w-]+)$/.exec(token);
    if (npm !== null) found.push({ kind: 'npm', script: npm[1] ?? '' });
    else if (make !== null) found.push({ kind: 'make', target: make[1] ?? '' });
    else if (TEST_FILE.test(head)) {
      found.push({
        kind: 'test',
        file: head,
        fragment: rest.length > 0 ? rest.join(' › ') : undefined,
      });
    }
  }
  const reason = /Not automated:\s*(.+)$/.exec(cell)?.[1];
  if (reason !== undefined) found.push({ kind: 'not-automated', reason: reason.trim() });
  return found;
}

/** The rows of the matrix: table lines whose first cell starts with a criterion id. */
export function parseMatrix(matrix: string): Row[] {
  const rows: Row[] = [];
  matrix.split('\n').forEach((line, index) => {
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    const first = /^(\d+\.\d+)\s+(.*)$/.exec(cells[1] ?? '');
    if (first === null) return;
    rows.push({
      id: first[1] ?? '',
      text: first[2] ?? '',
      line: index + 1,
      references: references(cells.slice(2).join(' ')),
    });
  });
  return rows;
}

export interface Facts {
  tests: ListedTest[];
  npmScripts: ReadonlySet<string>;
  makeTargets: ReadonlySet<string>;
}

export interface CheckOptions {
  /** Check only the rows that are present (for a draft of one section). */
  partial?: boolean;
  file?: string;
}

export function checkTraceability(
  requirements: string,
  matrix: string,
  facts: Facts,
  options: CheckOptions = {},
): Problem[] {
  const file = options.file ?? 'docs/traceability.md';
  const problems: Problem[] = [];
  const add = (message: string): void => {
    problems.push({ file, message });
  };
  const criteria = parseCriteria(requirements);
  const rows = parseMatrix(matrix);

  const seen = new Set<string>();
  for (const row of rows) {
    const where = `${row.id} (line ${row.line})`;
    if (seen.has(row.id)) add(`${where}: the criterion appears twice`);
    seen.add(row.id);
    if (!criteria.includes(row.id)) add(`${where}: requirements.md has no such criterion`);
    if (row.references.length === 0) add(`${where}: names nothing that verifies it`);

    for (const ref of row.references) {
      if (ref.kind === 'npm' && !facts.npmScripts.has(ref.script)) {
        add(`${where}: package.json has no script "${ref.script}"`);
      } else if (ref.kind === 'make' && !facts.makeTargets.has(ref.target)) {
        add(`${where}: the Makefile has no target "${ref.target}"`);
      } else if (ref.kind === 'test') {
        const inFile = facts.tests.filter((t) => t.file === ref.file);
        if (inFile.length === 0) {
          add(`${where}: ${ref.file} has no tests (missing file?)`);
        } else if (
          ref.fragment !== undefined &&
          !inFile.some((t) => t.name.includes(ref.fragment ?? ''))
        ) {
          add(`${where}: no test in ${ref.file} has "${ref.fragment}" in its name`);
        }
      } else if (ref.kind === 'not-automated' && ref.reason === '') {
        add(`${where}: "Not automated" without a reason`);
      }
    }
  }

  if (options.partial !== true) {
    for (const id of criteria) {
      if (!seen.has(id)) add(`${id}: the criterion is not in the matrix`);
    }
  }
  return problems;
}
