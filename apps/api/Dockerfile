# syntax=docker/dockerfile:1
# API NestJS — build MONOREPO. Contexte = racine du dépôt :
#   docker build -f apps/api/Dockerfile .
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @creche/prod-config
RUN npm run build --workspace @creche/api
RUN npm prune --omit=dev && mkdir -p apps/api/node_modules

FROM node:22-slim AS runtime
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
RUN mkdir -p /var/lib/creche-alerts && chown 65534:65534 /var/lib/creche-alerts
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
