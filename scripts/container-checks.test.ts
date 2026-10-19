import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkCompose, checkDockerfile } from './container-checks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');

const D = 'a'.repeat(64);

describe('the real files follow the rules', () => {
  it('Dockerfile', () => {
    expect(checkDockerfile(dockerfile)).toEqual([]);
  });
  it('docker-compose.yml', () => {
    expect(checkCompose(compose)).toEqual([]);
  });
});

describe('checkDockerfile', () => {
  const good = `FROM node:22@sha256:${D} AS build\nRUN npm ci\nFROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:${D}\nCOPY --from=build /src/dist /app/dist\nUSER nonroot:nonroot\nHEALTHCHECK CMD ["/nodejs/bin/node","/app/h.mjs"]\nCMD ["/app/main.mjs"]\n`;

  it('accepts a good one', () => {
    expect(checkDockerfile(good)).toEqual([]);
  });

  it.each([
    [
      'an image without a digest',
      good.replace(`node:22@sha256:${D}`, 'node:22'),
      /node:22 is not pinned by digest/,
    ],
    ['the latest tag', good.replace('node:22@', 'node:latest@'), /latest tag/],
    [
      'a final image that is not distroless',
      good.replace('gcr.io/distroless/nodejs22-debian12:nonroot', 'node:22-slim'),
      /not distroless/,
    ],
    [
      'a distroless image that runs as root',
      good.replace(':nonroot@', ':latest@'),
      /not the nonroot variant/,
    ],
    ['no USER', good.replace('USER nonroot:nonroot\n', ''), /USER nonroot/],
    ['USER root', good.replace('USER nonroot:nonroot', 'USER root'), /USER nonroot/],
    ['no health check', good.replace(/HEALTHCHECK.*\n/, ''), /no HEALTHCHECK/],
    [
      'a secret in an ENV',
      good.replace('USER nonroot', 'ENV LEDGERD_API_KEY=abc123\nUSER nonroot'),
      /secret in the image/,
    ],
    [
      'a secret in an ARG',
      good.replace('USER nonroot', 'ARG API_TOKEN=abc\nUSER nonroot'),
      /secret in the image/,
    ],
    [
      'the whole context copied in',
      good.replace('COPY --from=build /src/dist /app/dist', 'COPY . /app'),
      /whole build context/,
    ],
    [
      'a single stage',
      `FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:${D}\nUSER nonroot\nHEALTHCHECK CMD x\n`,
      /one stage and run in another/,
    ],
  ])('refuses %s', (_name, text, message) => {
    expect(
      checkDockerfile(text)
        .map((p) => p.message)
        .join('; '),
    ).toMatch(message);
  });

  it('does not take a stage name for an image', () => {
    expect(
      checkDockerfile(good.replace('FROM gcr.io', 'FROM build AS middle\nFROM gcr.io')).filter(
        (p) => p.message.includes('build'),
      ),
    ).toEqual([]);
  });
});

describe('checkCompose', () => {
  const good = `name: x
services:
  postgres:
    image: ghcr.io/o/pg:1@sha256:${D}
    environment:
      POSTGRES_PASSWORD: \${PW:?set it}
  ledgerd:
    image: ghcr.io/o/l:1@sha256:${D}
    environment:
      LEDGERD_API_KEY: \${LEDGERD_API_KEY:?set it}
    ports:
      - "127.0.0.1:\${P:-8085}:8085"
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
  console:
    build:
      context: .
    image: ledgerd-console:local
    environment:
      LEDGERD_API_KEY: \${LEDGERD_API_KEY:?set it}
    ports:
      - "127.0.0.1:8787:8787"
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
volumes:
  pgdata:
`;

  it('accepts a good one', () => {
    expect(checkCompose(good)).toEqual([]);
  });

  it.each([
    [
      'a release image without a digest',
      good.replace(`ghcr.io/o/l:1@sha256:${D}`, 'ghcr.io/o/l:1'),
      /service ledgerd: image ghcr.io\/o\/l:1 is not pinned/,
    ],
    ['the latest tag', good.replace('pg:1@', 'pg:latest@'), /latest tag/],
    [
      'a port on every interface',
      good.replace('"127.0.0.1:8787:8787"', '"8787:8787"'),
      /publishes 8787:8787 on all interfaces/,
    ],
    [
      'a port on 0.0.0.0',
      good.replace('"127.0.0.1:8787:8787"', '"0.0.0.0:8787:8787"'),
      /on all interfaces/,
    ],
    [
      'a writable console',
      good.replace(/(console:[\s\S]*?)read_only: true/, '$1read_only: false'),
      /service console does not have a read-only/,
    ],
    [
      'capabilities kept',
      good.replace(/(console:[\s\S]*?)cap_drop: \[ALL\]/, '$1cap_add: [NET_ADMIN]'),
      /service console does not drop all capabilities/,
    ],
    [
      'privileges allowed to grow',
      good.replace(/(console:[\s\S]*?)security_opt:\n\s+- no-new-privileges:true/, '$1'),
      /service console may gain privileges/,
    ],
    [
      'a privileged service',
      good.replace(
        '    read_only: true\n    cap_drop: [ALL]\n    security_opt:\n      - no-new-privileges:true\nvolumes',
        '    read_only: true\n    cap_drop: [ALL]\n    privileged: true\n    security_opt:\n      - no-new-privileges:true\nvolumes',
      ),
      /is privileged/,
    ],
    [
      'a password with a value',
      good.replace('${PW:?set it}', 'hunter2'),
      /POSTGRES_PASSWORD has a value written/,
    ],
    [
      'an API key with a value',
      good.replace(/LEDGERD_API_KEY: \$\{LEDGERD_API_KEY:\?set it\}/, 'LEDGERD_API_KEY: abc123'),
      /LEDGERD_API_KEY has a value written/,
    ],
    ['no services', 'name: x\n', /no services/],
  ])('refuses %s', (_name, text, message) => {
    expect(
      checkCompose(text)
        .map((p) => p.message)
        .join('; '),
    ).toMatch(message);
  });

  it('accepts a port that is only a container port (not published)', () => {
    expect(checkCompose(good.replace('      - "127.0.0.1:8787:8787"', '      - "8787"'))).toEqual(
      [],
    );
  });
});
