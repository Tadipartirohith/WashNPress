# Wash N Press backend, production image.
# Multi-stage: compile the TypeScript to a single bundled file, then run it with plain
# node on a slim runtime that carries only production dependencies.

# 1. Install all dependencies (including dev) for the build.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 2. Install only production dependencies for the runtime.
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 3. Minimal runtime image.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY config ./config
COPY package.json ./

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs && chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "dist/server.js"]
