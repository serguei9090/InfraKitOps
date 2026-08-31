/**
 * Single source of truth for the app version. Writes the same semver into the
 * three places that drift: app/package.json, app/src-tauri/tauri.conf.json,
 * app/src-tauri/Cargo.toml ([package] version).
 *
 *   bun run set-version 0.2.0
 *
 * With no argument it just prints the current values and flags a mismatch.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const pkgPath = join(root, 'package.json')
const confPath = join(root, 'src-tauri', 'tauri.conf.json')
const cargoPath = join(root, 'src-tauri', 'Cargo.toml')

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function read() {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  const conf = JSON.parse(readFileSync(confPath, 'utf8')) as { version: string }
  const cargo = readFileSync(cargoPath, 'utf8')
  const cargoVer = cargo.match(/^\s*\[package\][^[]*?^\s*version\s*=\s*"([^"]+)"/ms)?.[1] ?? '?'
  return { pkg, conf, cargo, cargoVer }
}

const next = process.argv[2]
const { pkg, conf, cargo, cargoVer } = read()

if (!next) {
  const all = [pkg.version, conf.version, cargoVer]
  const ok = all.every((v) => v === all[0])
  console.log(`package.json      ${pkg.version}`)
  console.log(`tauri.conf.json   ${conf.version}`)
  console.log(`Cargo.toml        ${cargoVer}`)
  console.log(ok ? '\n✓ in sync' : '\n✗ MISMATCH — run `bun run set-version <x>` to align')
  process.exit(ok ? 0 : 1)
}

if (!SEMVER.test(next)) {
  console.error(`not a semver: ${next}`)
  process.exit(1)
}

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

conf.version = next
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')

// Only the [package] version — leave any [dependencies] "version = " lines alone.
const newCargo = cargo.replace(
  /(^\s*\[package\][\s\S]*?^\s*version\s*=\s*")[^"]+(")/m,
  `$1${next}$2`,
)
writeFileSync(cargoPath, newCargo)

console.log(`version → ${next}  (package.json, tauri.conf.json, Cargo.toml)`)
