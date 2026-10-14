# syntax=docker/dockerfile:1
# Admin-web (React + vite) — statique servi par nginx AVEC fallback SPA
# (react-router : try_files → /index.html, sinon 404 sur routes profondes).
# docker build -f apps/admin-web/Dockerfile .
FROM node:22.23.3-trixie AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @creche/admin-web

FROM nginx:1.30.5-alpine3.24-slim AS runtime
# CVE-2026-103111 : pcre2 10.48-r0 (alpine 3.24) est vulnérable, mais l'image
# stable épinglée n'est pas reconstruite. On force la mise à jour système
# (10.49-r0 est la version corrigée publiée dans v3.24-main). Échec bloquant
# si la version corrigée n'est pas disponible — ne jamais masquer la CVE.
RUN apk add --no-cache --upgrade pcre2
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html
RUN printf 'server {\n\
  listen 80;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
