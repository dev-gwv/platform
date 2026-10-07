# Bun image for the IPC API. Build context is the REPO ROOT (monorepo), not
# services/api — the API imports workspace packages (@ipc/contracts etc.).
#
#   docker build -f services/api/Dockerfile -t ipc-api .
#
# Single stage on purpose: Bun's workspace install may place a dependency in the
# workspace's own node_modules (services/api/node_modules) rather than the root,
# so splitting install/runtime stages and copying only the root node_modules
# loses packages (e.g. hono). Installing in the final image keeps every
# node_modules tree. Bun runs TypeScript directly — no compile step.
FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production

# Manifests first for layer caching.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/contracts/package.json   packages/contracts/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/domain/package.json      packages/domain/package.json
COPY packages/help/package.json        packages/help/package.json
COPY services/api/package.json         services/api/package.json
COPY apps/web/package.json             apps/web/package.json
# --production drops devDeps; the API runtime needs only hono + postgres.
RUN bun install --frozen-lockfile --production

# Source (node_modules stays — .dockerignore excludes it from the context, so
# these COPYs don't clobber the installed trees).
COPY packages ./packages
COPY services/api ./services/api

EXPOSE 8787
USER bun
CMD ["bun", "run", "services/api/src/server.ts"]
