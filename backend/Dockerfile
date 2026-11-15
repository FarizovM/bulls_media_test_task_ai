FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY backend backend
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build --workspace @bulls-media/agent-backend

FROM build AS migration
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "migrate", "--workspace", "@bulls-media/agent-backend"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY backend/prisma backend/prisma
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --workspace @bulls-media/agent-backend --include-workspace-root=false; \
    else \
      npm install --omit=dev --workspace @bulls-media/agent-backend --include-workspace-root=false; \
    fi \
  && npm cache clean --force
COPY --from=build --chown=node:node /app/backend/dist backend/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/main.js"]
