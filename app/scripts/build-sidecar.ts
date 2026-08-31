/**
 * P7b — one entry point for the pre-`tauri build` / pre-`tauri dev` step that
 * Tauri can't do itself (cross-compiled Go).
 *
 *   bun run build:sidecar          # host triple
 *   bun run build:sidecar --all    # windows + linux amd64
 *
 * Runs, from the repo root:
 *   1. vendor-tools/fetch-tools.{sh,ps1}   — download + SHA-256-verify iperf3
 *   2. backend/build-sidecar.{sh,ps1}      — build backend + helper into
 *      app/src-tauri/binaries/<name>-<triple>[.exe] and copy the matching
 *      iperf3 next to them
 *
 * Picks the .ps1 on win32, the .sh elsewhere (CI ubuntu, Linux/macOS dev).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..', '..')
const isWin = process.platform === 'win32'
const all = process.argv.includes('--all')

function run(label: string, dir: string, shName: string, ps1Args: string[], shArgs: string[]) {
  const cwd = join(repoRoot, dir)
  const [cmd, args] = isWin
    ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `./${shName}.ps1`, ...ps1Args]]
    : ['bash', [`./${shName}.sh`, ...shArgs]]

  const script = join(cwd, `${shName}.${isWin ? 'ps1' : 'sh'}`)
  if (!existsSync(script)) {
    console.error(`✗ ${label}: ${script} not found`)
    process.exit(1)
  }

  console.log(`\n▶ ${label}  (${dir}/${shName}.${isWin ? 'ps1' : 'sh'} ${(isWin ? ps1Args : shArgs).join(' ')})`)
  const res = spawnSync(cmd as string, args as string[], { cwd, stdio: 'inherit' })
  if (res.status !== 0) {
    console.error(`✗ ${label} failed (exit ${res.status ?? 'signal ' + res.signal})`)
    process.exit(res.status ?? 1)
  }
}

run('fetch vendored tools', 'vendor-tools', 'fetch-tools', [], [])
run('build sidecar', 'backend', 'build-sidecar', all ? ['-All'] : [], all ? ['--all'] : [])

console.log('\n✓ sidecar binaries ready in app/src-tauri/binaries/')
