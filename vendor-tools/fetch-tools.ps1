# Downloads the binaries pinned in tools.lock into ./bin/, verifying each
# SHA-256. Safe to re-run.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$out = "bin"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$fail = $false

foreach ($line in Get-Content "tools.lock") {
  if ($line -match '^\s*#' -or $line.Trim() -eq '') { continue }
  $tool, $goos, $goarch, $want, $url = $line -split "`t"
  $dest = Join-Path $out "$tool-$goos-$goarch"

  if (Test-Path $dest) {
    $have = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
    if ($have -eq $want) { Write-Host "ok    $dest"; continue }
  }

  Write-Host "fetch $dest"
  $tmp = New-TemporaryFile
  if ($url -like '*.zip') {
    $zip = "$($tmp.FullName).zip"
    Invoke-WebRequest -Uri $url -OutFile $zip
    $ex = New-TemporaryFile; Remove-Item $ex
    Expand-Archive -Path $zip -DestinationPath $ex.FullName -Force
    $bin = Get-ChildItem -Path $ex.FullName -Recurse -Include 'iperf3*','*.exe' | Select-Object -First 1
    Copy-Item $bin.FullName $tmp.FullName -Force
    Remove-Item $zip, $ex.FullName -Recurse -Force
  } else {
    Invoke-WebRequest -Uri $url -OutFile $tmp.FullName
  }

  $got = (Get-FileHash $tmp.FullName -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $want) {
    Write-Warning "SHA-256 MISMATCH for $tool $goos/$goarch`n  want $want`n  got  $got"
    Remove-Item $tmp.FullName -Force
    $fail = $true
    continue
  }
  Move-Item $tmp.FullName $dest -Force
  Write-Host "  verified"
}

if ($fail) { exit 1 }
