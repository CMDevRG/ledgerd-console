/*
 * Static checks of the Dockerfile and docker-compose.yml: what must hold for the console to be
 * reproducible and not give more than it needs. Pure functions over the file text, so each rule
 * can be shown to fail; scripts/check-containers.ts runs them on the real files.
 */
export interface Problem {
  file: string;
  message: string;
}

const DIGEST = /@sha256:[0-9a-f]{64}/;

export function checkDockerfile(text: string, file = 'Dockerfile'): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string): void => {
    problems.push({ file, message });
  };
  const lines = text.split('\n').map((l) => l.trim());

  const stages = new Set<string>();
  const froms = lines.filter((l) => /^FROM\s/i.test(l));
  for (const line of froms) {
    const match = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    const image = match?.[1] ?? '';
    if (match?.[2] !== undefined) stages.add(match[2]);
    if (stages.has(image)) continue; // a stage of this file
    if (!DIGEST.test(image)) add(`${image} is not pinned by digest`);
    if (/:latest\b/.test(image)) add(`${image} uses the latest tag`);
  }
  if (froms.length < 2) add('should build in one stage and run in another');

  const last = froms.at(-1) ?? '';
  if (!last.includes('distroless')) add('the final image is not distroless');
  if (!last.includes(':nonroot')) add('the final image is not the nonroot variant');
  const afterLast = lines.slice(lines.indexOf(last));
  if (!afterLast.some((l) => /^USER\s+nonroot/.test(l)))
    add('the final image does not say USER nonroot');
  if (!afterLast.some((l) => /^HEALTHCHECK\s/.test(l))) add('the final image has no HEALTHCHECK');
  if (afterLast.some((l) => /^(ENV|ARG)\s+\S*(KEY|SECRET|PASSWORD|TOKEN)\S*\s*=\s*\S+/i.test(l))) {
    add('puts a secret in the image (ENV or ARG with a value)');
  }
  if (afterLast.some((l) => /^COPY\s+(\.|\*)\s/.test(l)))
    add('copies the whole build context into the final image');
  return problems;
}

interface Service {
  name: string;
  lines: string[];
}

/** The services of a compose file: the lines under each name at the first indent level. */
function services(text: string): Service[] {
  const all = text.split('\n');
  const start = all.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) return [];
  const found: Service[] = [];
  for (const line of all.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break; // the next top-level key
    const name = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)?.[1];
    if (name !== undefined) found.push({ name, lines: [] });
    else found.at(-1)?.lines.push(line);
  }
  return found;
}

/** Services that accept requests and so are hardened. */
const HARDENED = ['ledgerd', 'console'];

export function checkCompose(text: string, file = 'docker-compose.yml'): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string): void => {
    problems.push({ file, message });
  };
  const found = services(text);
  if (found.length === 0) add('has no services');

  for (const service of found) {
    const body = service.lines.join('\n');
    const image = /^\s+image:\s*(\S+)/m.exec(body)?.[1];
    const built = /^\s+build:/m.test(body);
    if (image === undefined) add(`service ${service.name} has no image`);
    else if (!built && !DIGEST.test(image))
      add(`service ${service.name}: image ${image} is not pinned by digest`);
    if (image !== undefined && /:latest\b/.test(image))
      add(`service ${service.name}: image ${image} uses the latest tag`);

    // A published port is reachable only from this machine.
    for (const port of body.matchAll(/^\s+-\s*["']?([^"'\s]*:\d+(?::\d+)?)["']?\s*$/gm)) {
      const mapping = port[1] ?? '';
      if (mapping.split(':').length >= 2 && !mapping.startsWith('127.0.0.1:')) {
        add(
          `service ${service.name}: publishes ${mapping} on all interfaces (bind it to 127.0.0.1)`,
        );
      }
    }

    if (HARDENED.includes(service.name)) {
      if (!/^\s+read_only:\s*true/m.test(body))
        add(`service ${service.name} does not have a read-only filesystem`);
      if (!/^\s+cap_drop:\s*\[\s*ALL\s*\]/m.test(body))
        add(`service ${service.name} does not drop all capabilities`);
      if (!body.includes('no-new-privileges:true'))
        add(`service ${service.name} may gain privileges (no-new-privileges)`);
      if (/^\s+privileged:\s*true/m.test(body)) add(`service ${service.name} is privileged`);
    }
  }

  // No secret has a value in the file: each comes from .env, and compose stops if it is missing.
  for (const match of text.matchAll(
    /^\s+([A-Z0-9_]*(?:PASSWORD|API_KEY|SECRET|TOKEN)[A-Z0-9_]*):\s*(.+)$/gm,
  )) {
    const value = (match[2] ?? '').trim();
    if (!/\$\{[A-Z0-9_]+:\?[^}]*\}/.test(value) && !/\$\{[A-Z0-9_]+\}/.test(value)) {
      add(`${match[1] ?? ''} has a value written in the file`);
    }
  }
  return problems;
}
