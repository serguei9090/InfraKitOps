#!/usr/bin/env bash
# Downloads the binaries pinned in tools.lock into ./bin/, verifying each
# SHA-256. Safe to re-run; skips files already present and valid.
set -euo pipefail
cd "$(dirname "$0")"

LOCK="tools.lock"
OUT="bin"
mkdir -p "$OUT"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
  fi
}

fail=0
while IFS=$'\t' read -r tool goos goarch want url; do
  case "$tool" in ''|\#*) continue ;; esac
  dest="$OUT/${tool}-${goos}-${goarch}"

  if [ -f "$dest" ] && [ "$(sha256 "$dest")" = "$want" ]; then
    echo "ok    $dest"
    continue
  fi

  echo "fetch $dest"
  tmp="$(mktemp)"
  if [[ "$url" == *.zip ]]; then
    zip="$(mktemp).zip"
    curl -fsSL -o "$zip" "$url"
    unzip -p "$zip" '*iperf3*' > "$tmp" 2>/dev/null || unzip -p "$zip" '*.exe' > "$tmp"
    rm -f "$zip"
  else
    curl -fsSL -o "$tmp" "$url"
  fi

  got="$(sha256 "$tmp")"
  if [ "$got" != "$want" ]; then
    echo "  SHA-256 MISMATCH for $tool $goos/$goarch" >&2
    echo "  want $want" >&2
    echo "  got  $got" >&2
    rm -f "$tmp"; fail=1; continue
  fi
  chmod +x "$tmp"
  mv "$tmp" "$dest"
  echo "  verified"
done < "$LOCK"

exit $fail
