# syntax=docker/dockerfile:1
# Console support (React + vite) — statique nginx + fallback SPA.
# docker build -f apps/support-console/Dockerfile .
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @creche/support-console

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/support-console/dist /usr/share/nginx/html
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
