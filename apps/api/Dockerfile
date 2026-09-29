# syntax=docker/dockerfile:1
# API NestJS — build MONOREPO. Contexte = racine du dépôt :
#   docker build -f apps/api/Dockerfile .
FROM node:22.23.3-trixie AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @creche/prod-config
RUN npm run build --workspace @creche/api
RUN npm prune --omit=dev && mkdir -p apps/api/node_modules

FROM node:22.23.3-alpine3.24 AS runtime
ENV NODE_ENV=production
WORKDIR /app
# npm ci a déjà tourné en build : on copie l'arbre prod TEL QUEL
# (package-lock inclus pour la reproductibilité documentée).
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
# Preserve non-hoisted runtime modules (bcryptjs 2.x is scoped to this workspace).
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/operations ./apps/api/operations
# The production process uses only Node; drop bundled package managers and their dependency trees.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /var/lib/creche-alerts \
    && chown 65534:65534 /var/lib/creche-alerts
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
