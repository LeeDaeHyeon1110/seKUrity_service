FROM node:22-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 vinext

COPY --from=builder --chown=vinext:nodejs /app/dist/standalone ./
COPY --from=builder --chown=vinext:nodejs /app/node_modules/react ./node_modules/react
COPY --from=builder --chown=vinext:nodejs /app/node_modules/react-dom ./node_modules/react-dom
COPY --from=builder --chown=vinext:nodejs /app/node_modules/scheduler ./node_modules/scheduler

USER vinext

EXPOSE 3000

CMD ["node", "server.js"]
