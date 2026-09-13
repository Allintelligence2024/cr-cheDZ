# syntax=docker/dockerfile:1
# Admin-web (React + vite) — statique servi par nginx AVEC fallback SPA
# (react-router : try_files → /index.html, sinon 404 sur routes profondes).
# docker build -f apps/admin-web/Dockerfile .
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @creche/admin-web

FROM nginx:1.27-alpine AS runtime
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
