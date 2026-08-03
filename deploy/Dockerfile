# ---- Build stage ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

# 小内存服务器上 tsc/vite 容易 OOM，提高 Node 堆上限。
# 若宿主机 RAM 很小，下方仍会跳过 tsc，只跑 vite build。
ENV NODE_OPTIONS=--max-old-space-size=3072

WORKDIR /app

ENV VITE_DEFAULT_API_URL=__VITE_DEFAULT_API_URL_PLACEHOLDER__
ENV VITE_API_PROXY_AVAILABLE=__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__
ENV VITE_API_PROXY_LOCKED=__VITE_API_PROXY_LOCKED_PLACEHOLDER__
ENV VITE_DOCKER_DEPLOYMENT=__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__
ENV VITE_DOCKER_LEGACY_API_URL_USED=__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__
ENV VITE_SHOW_DEFAULT_CONFIG_ONLY=__VITE_SHOW_DEFAULT_CONFIG_ONLY_PLACEHOLDER__

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Docker 镜像构建用轻量脚本：跳过 tsc 全量类型检查，避免低配服务器 OOM。
RUN npm run build:docker

# ---- Production stage ----
FROM nginx:alpine

ENV HOST=0.0.0.0
ENV PORT=80
ENV DEFAULT_API_URL=
ENV API_PROXY_URL=
ENV ENABLE_API_PROXY=false
ENV LOCK_API_PROXY=false
ENV SHOW_DEFAULT_CONFIG_ONLY=false

COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/migrate-api-env.envsh /docker-entrypoint.d/05-migrate-api-env.envsh
COPY --chmod=755 deploy/inject-api-url.sh /docker-entrypoint.d/40-inject-api-url.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
