# Wash N Press web application. Multi stage build that compiles the Next.js app and
# runs the minimal standalone server on plain node.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Where the browser should send its API calls.
#
# NEXT_PUBLIC_* is inlined into the client bundle by the compiler, so this is a build
# time value and not a runtime one: setting it on the running container does nothing,
# because by then the string is already baked into the JavaScript the browser gets.
# It was declared nowhere at all, so every image built from this file shipped
# lib/api-client.ts's fallback of http://localhost:8090 — a deployed site whose every
# portal fails on "Network request failed", which is a browser reaching for a port on
# the visitor's own machine. Platforms that build from a Dockerfile (Railway among
# them) supply service variables as build arguments, which this picks up.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 8080
CMD ["node", "server.js"]
