FROM node:22-alpine AS deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/web-admin/package.json apps/web-admin/package.json

RUN npm ci --workspace apps/web-admin --include-workspace-root=false

FROM node:22-alpine AS builder
WORKDIR /workspace

ARG NEXT_PUBLIC_API_URL=/api

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web-admin ./apps/web-admin

RUN npm run build --workspace apps/web-admin

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /workspace/apps/web-admin/.next-prod/standalone ./
COPY --from=builder /workspace/apps/web-admin/.next-prod/static ./apps/web-admin/.next-prod/static
COPY --from=builder /workspace/apps/web-admin/public ./apps/web-admin/public

EXPOSE 3000

CMD ["node", "apps/web-admin/server.js"]
