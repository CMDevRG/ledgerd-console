/*
 * Checks that the documentation (R18) says what it must and does not drift from the project:
 * the README has its sections, shows a screenshot of every page and no screenshot that is not
 * used, states the ledgerd version the project is generated from, documents every environment
 * variable the server reads, and mentions only commands that exist; the decision records cover
 * the decisions R18.2 names and are all listed. Pure functions over text and file lists, so each
 * rule can be shown to fail; scripts/check-docs.ts runs them on the real files.
 */
import type { Problem } from './container-checks';

export interface ReadmeFacts {
  /** File names in docs/screenshots. */
  screenshots: readonly string[];
  /** Paths (relative to the repository root) that exist, for checking links. */
  exists: (path: string) => boolean;
  npmScripts: ReadonlySet<string>;
  makeTargets: ReadonlySet<string>;
  /** The text of package.json, of docker-compose.yml and of server/src/config.ts. */
  packageJson: string;
  compose: string;
  serverConfig: string;
}

const SECTIONS = [
  'Screenshots',
  'Quick start',
  'Architecture',
  'Commands',
  'Configuration',
  'Security model',
  'How it is tested',
  'Limitations',
];

/** One screenshot per page of the application (R18.1). */
const PAGE_SCREENSHOTS = [
  'overview',
  'accounts',
  'account-detail',
  'new-transaction',
  'transaction',
  'transaction-lookup',
  'lab-overdraft',
  'reconciliation',
  'benchmark-charts',
  'settings',
];

export function checkReadme(readme: string, facts: ReadmeFacts, file = 'README.md'): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string): void => {
    problems.push({ file, message });
  };

  const headings = new Set([...readme.matchAll(/^##+ (.+)$/gm)].map((m) => m[1]?.trim()));
  for (const section of SECTIONS) {
    if (![...headings].some((h) => h?.startsWith(section))) add(`has no "${section}" section`);
  }
  if (!/^```mermaid$/m.test(readme)) add('has no architecture diagram (a mermaid block)');
  if (!/Why the key stays on the server/i.test(readme)) {
    add('does not explain why the API key stays on the server');
  }

  // Screenshots: every page has one, every link resolves, none is left unused.
  const used = new Set(
    [...readme.matchAll(/docs\/screenshots\/([\w.-]+\.png)/g)].map((m) => m[1] ?? ''),
  );
  for (const name of PAGE_SCREENSHOTS) {
    if (!used.has(`${name}.png`)) add(`shows no screenshot named ${name}.png`);
  }
  for (const name of used) {
    if (!facts.screenshots.includes(name))
      add(`links docs/screenshots/${name}, which does not exist`);
  }
  for (const name of facts.screenshots) {
    if (!used.has(name)) add(`docs/screenshots/${name} is not used (remove it or show it)`);
  }

  // Links to files of this repository resolve.
  for (const match of readme.matchAll(/\]\(((?!https?:|#|mailto:)[^)\s]+)\)/g)) {
    const target = (match[1] ?? '').split('#')[0] ?? '';
    if (target !== '' && !facts.exists(target)) add(`links to ${target}, which does not exist`);
  }

  // The ledgerd version: the one the types are generated from, and the one compose runs.
  const generated = /ledgerd\/v(\d+\.\d+\.\d+)\/docs\/openapi\.yaml/.exec(facts.packageJson)?.[1];
  if (generated === undefined) {
    add('cannot find the ledgerd version in the generate:api script of package.json');
  } else {
    if (!readme.includes(`ledgerd ${generated}`)) {
      add(`does not say it requires ledgerd ${generated} (the version the API types come from)`);
    }
    const tags = [...facts.compose.matchAll(/ghcr\.io\/cmdevrg\/ledgerd[\w-]*:(\d+\.\d+\.\d+)@/g)];
    if (tags.length === 0 || tags.some((t) => t[1] !== generated)) {
      add(`docker-compose.yml does not run ledgerd ${generated} everywhere`);
    }
  }
  if (!readme.includes('npm run generate:api'))
    add('does not say how to update the generated API types');

  // Commands: every one the README names exists.
  for (const m of readme.matchAll(/`npm run ([\w:-]+)`/g)) {
    if (!facts.npmScripts.has(m[1] ?? ''))
      add(`mentions npm run ${m[1] ?? ''}, which does not exist`);
  }
  for (const m of readme.matchAll(/`make ([\w-]+)/g)) {
    if (!facts.makeTargets.has(m[1] ?? ''))
      add(`mentions make ${m[1] ?? ''}, which does not exist`);
  }

  // Configuration: every variable the server reads is in the table.
  const variables = new Set(
    [...facts.serverConfig.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]),
  );
  for (const name of variables) {
    if (!readme.includes(`\`${name ?? ''}\``)) add(`does not document the variable ${name ?? ''}`);
  }
  return problems;
}

const ADR_TOPICS: [RegExp, string][] = [
  [/api key/i, 'why the API key is held by a server'],
  [/money/i, 'the money-handling rule'],
  [/generated/i, 'the choice of generated API types'],
  [/failure lab/i, 'how the Failure Lab is tested'],
];

export function checkAdrs(
  files: Record<string, string>,
  index: string,
  file = 'docs/adr',
): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string, at = file): void => {
    problems.push({ file: at, message });
  };
  const adrs = Object.entries(files).filter(([name]) => /^\d{4}-.+\.md$/.test(name));

  for (const [name, text] of adrs) {
    if (!index.includes(`](${name})`)) add('is not listed in the index', `${file}/${name}`);
    if (!/^# \d{4}\. /.test(text)) add('has no "# NNNN. Title" heading', `${file}/${name}`);
    for (const section of ['Status:', '## Context', '## Decision', '## Consequences']) {
      if (!text.includes(section)) add(`has no "${section}"`, `${file}/${name}`);
    }
  }
  for (const link of index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)) {
    if (!adrs.some(([name]) => name === link[1])) {
      add(`the index links to ${link[1] ?? ''}, which does not exist`);
    }
  }
  for (const [pattern, what] of ADR_TOPICS) {
    const titles = adrs.map(([, text]) => /^# .+$/m.exec(text)?.[0] ?? '');
    if (!titles.some((t) => pattern.test(t))) add(`no decision record covers ${what}`);
  }
  return problems;
}
