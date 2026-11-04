# Build context is the repo root:  docker build -f apps/api/Dockerfile .
FROM node:22-slim
RUN npm install -g pnpm@10
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile --filter @ledgerlite/api...
RUN pnpm --filter @ledgerlite/shared build && pnpm --filter @ledgerlite/api build
ENV NODE_ENV=production
EXPOSE 3000
# Migrations are idempotent (schema_migrations table); apply, then serve.
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && node apps/api/dist/main.js"]
