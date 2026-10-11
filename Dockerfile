# Multi-stage Dockerfile for SecureDocX
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++

# 1. Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# 2. Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Generate Prisma Client and compile Next.js
RUN npx prisma generate
RUN npm run build

# 3. Production runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy build outputs, Prisma, and storage directories
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/lib/contract-deployment.json ./src/lib/contract-deployment.json
COPY --from=builder /app/storage ./storage

# Ensure storage directory exists with write permissions
RUN mkdir -p /app/storage/encrypted

EXPOSE 3000

# Push DB schema on startup if needed, then run Next.js
CMD ["sh", "-c", "npx prisma db push && npm start"]
