FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
ARG VITE_OIDC_AUTHORITY
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_SCOPE="openid agent:read agent:triage"
ARG VITE_REQUIRE_OIDC=true
ARG OIDC_ORIGIN
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY
ENV VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
ENV VITE_OIDC_SCOPE=$VITE_OIDC_SCOPE
ENV VITE_REQUIRE_OIDC=$VITE_REQUIRE_OIDC
ENV OIDC_ORIGIN=$OIDC_ORIGIN
RUN test "$VITE_REQUIRE_OIDC" = "true" && test -n "$VITE_OIDC_AUTHORITY" && test -n "$VITE_OIDC_CLIENT_ID" && test -n "$OIDC_ORIGIN"
RUN npm run build --workspace @bulls-media/agent-dashboard

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
ENV NGINX_ENVSUBST_FILTER=^OIDC_ORIGIN$
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
