# syntax=docker/dockerfile:1
# Worker (jobs, exports Excel, PDF bilingue, purge vidéo) — même patron que l'API.
# docker build -f apps/worker/Dockerfile .
FROM node:22.23.3-trixie AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @creche/prod-config
RUN npm run build --workspace @creche/worker
RUN npm prune --omit=dev

FROM node:22.23.3-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
# The production process uses only Node; drop bundled package managers and their dependency trees.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
# Aucun port : le worker tire des jobs en base (DATABASE_URL au runtime).
CMD ["node", "apps/worker/dist/main.js"]
