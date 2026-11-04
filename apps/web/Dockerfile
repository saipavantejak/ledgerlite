# Build context is the repo root:  docker build -f apps/web/Dockerfile .
FROM node:22-slim AS build
RUN npm install -g pnpm@10
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile --filter @ledgerlite/web...
ARG VITE_API_URL=/api
ARG VITE_API_KEY=
ENV VITE_API_URL=$VITE_API_URL VITE_API_KEY=$VITE_API_KEY
RUN pnpm --filter @ledgerlite/shared build && pnpm --filter @ledgerlite/web build

FROM nginx:1.27-alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
