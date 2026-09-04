# InfraKit Studio — hosted web deployment image (DEPLOY_PLAN.md D2).
# One container: the Go backend serves both /api/v1 and the built React
# frontend on a single port. TLS is expected to be terminated by a reverse
# proxy in front (see deploy/compose.yml) — hence INFRAKIT_BEHIND_PROXY.
#
#   docker build -t infrakit-studio .
#   docker run -p 8080:8080 -v infrakit-data:/data \
#     -e INFRAKIT_VAULT_PASSPHRASE_FILE=/run/secrets/vp infrakit-studio

# --- 1. frontend -----------------------------------------------------------
FROM oven/bun:1 AS web
WORKDIR /src/app
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/ ./
# Empty VITE_BACKEND_URL = same-origin: the frontend calls /api/v1 on
# whatever host it was served from.
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN bun run build

# --- 2. backend ----------------------------------------------------------
FROM golang:1.25 AS api
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath \
    -ldflags "-s -w -X github.com/infrakit/backend/internal/api.Version=${VERSION}" \
    -o /out/infrakit-backend ./cmd/infrakit-backend

# --- 3. runtime --------------------------------------------------------
FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git openssh-client curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin app \
    && mkdir -p /data /backups /app/web \
    && chown -R app:app /data /backups /app

COPY --from=api  /out/infrakit-backend  /usr/local/bin/infrakit-backend
COPY --from=web  /src/app/dist          /app/web

USER app
WORKDIR /app
VOLUME ["/data", "/backups"]
EXPOSE 8080

# Sensible hosted defaults; every one is overridable at `docker run`.
ENV INFRAKIT_ADDR=0.0.0.0:8080 \
    INFRAKIT_AUTH=on \
    INFRAKIT_BEHIND_PROXY=1 \
    INFRAKIT_STATIC_DIR=/app/web \
    INFRAKIT_DATA_DIR=/data \
    INFRAKIT_LOG_FORMAT=json \
    INFRAKIT_BACKUP_DIR=/backups

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:8080/api/v1/health || exit 1

ENTRYPOINT ["infrakit-backend"]
