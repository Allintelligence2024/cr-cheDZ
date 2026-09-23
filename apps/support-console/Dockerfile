# syntax=docker/dockerfile:1
# Console support (React + vite) — statique nginx + fallback SPA.
# docker build -f apps/support-console/Dockerfile .
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @creche/support-console

FROM nginx:1.27-alpine AS runtime
# ⚠️ Le bundle est construit avec `base: '/support/'` (vite.config.ts) : le
# index.html généré demande /support/assets/*. Le reverse proxy amont fait un
# `proxy_pass http://support_backend;` SANS slash final, donc le préfixe
# /support/ est conservé jusqu'ici. Les fichiers doivent donc vivre SOUS
# html/support/, sinon /support/assets/*.js tombe dans le fallback try_files,
# renvoie index.html en text/html, le module ne s'exécute jamais → page
# blanche. Garde-fou : scripts/check-spa-static-paths.mjs.
COPY --from=build /app/apps/support-console/dist /usr/share/nginx/html/support
RUN printf 'server {\n\
  listen 80;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location = / {\n\
    return 302 /support/;\n\
  }\n\
  location /support/ {\n\
    try_files $uri $uri/ /support/index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
