# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
# Base images are pinned by digest so builds are reproducible. Update them deliberately
# (and run the checks), not by accident. Dependabot proposes the updates.
FROM node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS build

WORKDIR /src

# Dependencies first: this layer is reused until the lock file changes. Install scripts are
# not run; nothing here needs them.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

COPY . .

# The build fails the image if the type check fails, if the page would break the Content
# Security Policy, or if a throwaway build with a canary key finds it in the output.
RUN npm run build && npm run check:build

# ---- run ------------------------------------------------------------------
# distroless/nodejs: Node and nothing else (no shell, no package manager). Runs as the
# unprivileged "nonroot" user.
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e

ARG VERSION=dev
ARG COMMIT=unknown
LABEL org.opencontainers.image.title="ledgerd-console" \
      org.opencontainers.image.description="A web console for ledgerd, a double-entry ledger, with a server that keeps the API key out of the browser" \
      org.opencontainers.image.source="https://github.com/CMDevRG/ledgerd-console" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}"

WORKDIR /app
# The server is one file with its dependencies bundled inside it; the web application is the
# folder of static files it serves.
COPY --from=build /src/dist-server/main.mjs /app/main.mjs
COPY --from=build /src/dist /app/dist
COPY docker/healthcheck.mjs /app/healthcheck.mjs

# Inside a container the server must listen on all interfaces, or the published port could not
# reach it. Who can reach the container is decided by where the port is published (docker-compose.yml
# publishes it on 127.0.0.1 only).
ENV NODE_ENV=production \
    CONSOLE_ADDR=0.0.0.0:8787 \
    CONSOLE_STATIC_DIR=/app/dist

USER nonroot:nonroot
EXPOSE 8787

# The image has no curl, so a small Node script probes /healthz.
HEALTHCHECK --interval=10s --timeout=4s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]

CMD ["/app/main.mjs"]
