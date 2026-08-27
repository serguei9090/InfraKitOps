#!/usr/bin/env bash
# Cross-compiles the backend into app/src-tauri/binaries/ with the
# target-triple suffix Tauri's sidecar resolver expects. Run before
# `bun run tauri dev` / `bun run tauri build`.
#
# Usage:
#   ./build-sidecar.sh              # build for the host triple only
#   ./build-sidecar.sh --all        # build for windows + linux amd64
set -euo pipefail

cd "$(dirname "$0")"
OUT="../app/src-tauri/binaries"
mkdir -p "$OUT"

VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
LDFLAGS="-s -w -X github.com/infrakit/backend/internal/api.Version=${VERSION}"

build() {
  local goos="$1" goarch="$2" triple="$3" ext="${4:-}"
  echo "building ${triple} ..."
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "$LDFLAGS" \
    -o "$OUT/infrakit-backend-${triple}${ext}" ./cmd/infrakit-backend
  # the one-shot elevated helper (spawned by the backend for hosts-file writes)
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "-s -w" \
    -o "$OUT/infrakit-helper-${triple}${ext}" ./cmd/infrakit-helper
}

host_triple="$(rustc -vV | sed -n 's/host: //p')"

case "${1:-}" in
  --all)
    build windows amd64 x86_64-pc-windows-msvc .exe
    build linux   amd64 x86_64-unknown-linux-gnu
    ;;
  *)
    case "$host_triple" in
      *windows*) build windows amd64 x86_64-pc-windows-msvc .exe ;;
      *linux*)   build linux   amd64 x86_64-unknown-linux-gnu ;;
      *)         echo "unsupported host triple: $host_triple" >&2; exit 1 ;;
    esac
    ;;
esac

echo "done -> $OUT"
ls -la "$OUT"
