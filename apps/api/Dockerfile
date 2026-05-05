FROM node:22-alpine AS deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json

RUN npm ci --workspace apps/api --include-workspace-root=false

FROM node:22-alpine AS builder
WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api

RUN npm run build --workspace apps/api

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=builder /workspace/apps/api/dist ./dist
COPY --from=builder /workspace/apps/api/package.json ./package.json

RUN mkdir -p /app/data/backups

EXPOSE 4000

CMD ["node", "dist/server.js"]
