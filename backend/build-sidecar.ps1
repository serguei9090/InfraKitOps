# Cross-compiles the backend into app/src-tauri/binaries/ with the
# target-triple suffix Tauri's sidecar resolver expects. Run before
# `bun run tauri dev` / `bun run tauri build`.
#
#   ./build-sidecar.ps1          # host triple only
#   ./build-sidecar.ps1 -All     # windows + linux amd64
param([switch]$All)
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
$out = "../app/src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$version = (git describe --tags --always --dirty 2>$null); if (-not $version) { $version = "dev" }
$ldflags = "-s -w -X github.com/infrakit/backend/internal/api.Version=$version"

function Build($goos, $goarch, $triple, $ext) {
  Write-Host "building $triple ..."
  $env:CGO_ENABLED = "0"; $env:GOOS = $goos; $env:GOARCH = $goarch
  go build -trimpath -ldflags $ldflags -o "$out/infrakit-backend-$triple$ext" ./cmd/infrakit-backend
  go build -trimpath -ldflags "-s -w" -o "$out/infrakit-helper-$triple$ext" ./cmd/infrakit-helper
}

$hostTriple = (rustc -vV | Select-String '^host: ').ToString().Replace("host: ", "").Trim()

if ($All) {
  Build "windows" "amd64" "x86_64-pc-windows-msvc" ".exe"
  Build "linux"   "amd64" "x86_64-unknown-linux-gnu" ""
} elseif ($hostTriple -like "*windows*") {
  Build "windows" "amd64" "x86_64-pc-windows-msvc" ".exe"
} elseif ($hostTriple -like "*linux*") {
  Build "linux" "amd64" "x86_64-unknown-linux-gnu" ""
} else {
  throw "unsupported host triple: $hostTriple"
}

Write-Host "done -> $out"
Get-ChildItem $out
