# Downloads the binaries pinned in tools.lock into ./bin/, verifying each
# SHA-256. Safe to re-run.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Plain .NET instead of Get-FileHash — on some hosted-runner pwsh installs
# Get-FileHash / New-TemporaryFile throw CommandNotFoundException even
# though the rest of Microsoft.PowerShell.Utility (Invoke-WebRequest,
# Write-Host, ...) resolves fine. Not worth chasing why; this has no
# cmdlet dependency at all.
function Get-Sha256Hex([string]$Path) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $hash = $sha256.ComputeHash($stream)
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha256.Dispose()
  }
  return -join ($hash | ForEach-Object { $_.ToString('x2') })
}

$out = "bin"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$fail = $false

foreach ($line in Get-Content "tools.lock") {
  if ($line -match '^\s*#' -or $line.Trim() -eq '') { continue }
  $tool, $goos, $goarch, $want, $url = $line -split "`t"
  $dest = Join-Path $out "$tool-$goos-$goarch"

  if (Test-Path $dest) {
    $have = Get-Sha256Hex $dest
    if ($have -eq $want) { Write-Host "ok    $dest"; continue }
  }

  Write-Host "fetch $dest"
  # [System.IO.Path] helpers instead of New-TemporaryFile — the latter isn't
  # reliably available under pwsh on hosted runners (CommandNotFoundException).
  $tmp = [System.IO.Path]::GetTempFileName()
  if ($url -like '*.zip') {
    $zip = "$tmp.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip
    $exDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $exDir -Force | Out-Null
    Expand-Archive -Path $zip -DestinationPath $exDir -Force
    $bin = Get-ChildItem -Path $exDir -Recurse -Include 'iperf3*','*.exe' | Select-Object -First 1
    Copy-Item $bin.FullName $tmp -Force
    Remove-Item $zip, $exDir -Recurse -Force
  } else {
    Invoke-WebRequest -Uri $url -OutFile $tmp
  }

  $got = Get-Sha256Hex $tmp
  if ($got -ne $want) {
    Write-Warning "SHA-256 MISMATCH for $tool $goos/$goarch`n  want $want`n  got  $got"
    Remove-Item $tmp -Force
    $fail = $true
    continue
  }
  Move-Item $tmp $dest -Force
  Write-Host "  verified"
}

if ($fail) { exit 1 }
