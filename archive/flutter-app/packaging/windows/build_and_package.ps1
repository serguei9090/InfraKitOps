# Builds InfraKit Studio's Windows release and compiles it into a single
# installer (packaging\windows\infrakit_studio.iss). Run from anywhere;
# paths below are all relative to this script's own location.
#
# Requires: Flutter SDK on PATH, Inno Setup 6 (ISCC.exe) either on PATH or
# at the default per-user install location this script also checks.

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ReleaseDir = Join-Path $RepoRoot "build\windows\x64\runner\Release"
$WebBuildDir = Join-Path $RepoRoot "build\web"
$WebDestDir = Join-Path $ReleaseDir "web"

Write-Host "==> flutter build windows" -ForegroundColor Cyan
Push-Location $RepoRoot
try {
    flutter build windows
    if ($LASTEXITCODE -ne 0) { throw "flutter build windows failed" }

    Write-Host "==> flutter build web" -ForegroundColor Cyan
    flutter build web
    if ($LASTEXITCODE -ne 0) { throw "flutter build web failed" }
}
finally {
    Pop-Location
}

Write-Host "==> Copying web/ build into the Windows release folder (adjacent-folder delivery model)" -ForegroundColor Cyan
if (Test-Path $WebDestDir) { Remove-Item $WebDestDir -Recurse -Force }
Copy-Item $WebBuildDir $WebDestDir -Recurse

$Iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
if (-not $Iscc) {
    $DefaultIscc = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    if (Test-Path $DefaultIscc) {
        $IsccPath = $DefaultIscc
    } else {
        throw "ISCC.exe not found on PATH or at the default per-user install location. Install Inno Setup 6 first (winget install JRSoftware.InnoSetup)."
    }
} else {
    $IsccPath = $Iscc.Source
}

Write-Host "==> Compiling installer with $IsccPath" -ForegroundColor Cyan
& $IsccPath (Join-Path $PSScriptRoot "infrakit_studio.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC compile failed" }

Write-Host "==> Done. Installer is in build\installer\" -ForegroundColor Green
