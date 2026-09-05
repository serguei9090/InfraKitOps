/**
 * Regenerates docs/assets/ — per-screen PNGs and a short demo clip (mp4 + gif).
 *
 * How it works:
 *   1. Serves the *built* frontend + API from ONE origin via the backend's
 *      `--static-dir` (same code path as the real hosted deployment).
 *   2. Reads the per-launch bearer token off the backend's stdout and injects
 *      it as the `infrakit:backend-endpoint` localStorage override, so the
 *      served web build talks to its own API with no login screen.
 *   3. Drives headless Chromium (Playwright) through a curated route list,
 *      screenshotting each, then records one scripted walkthrough.
 *   4. ffmpeg turns the walkthrough .webm into docs/assets/demo.{mp4,gif}.
 *
 * Prereqs (checked at start, with a clear error):
 *   - app/dist built            → `cd app && bun run build`
 *   - the sidecar binary built  → `cd app && bun run build:sidecar`
 *   - ffmpeg on PATH
 *
 * Run:  cd tools/capture && bun install && bun run capture
 */
import { chromium, type Page } from 'playwright'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const DIST = join(REPO, 'app/dist')
const ASSETS = join(REPO, 'docs/assets')
const SHOTS = join(ASSETS, 'screenshots')
const VIDDIR = join(HERE, 'videos')
const PORT = 8899
const BASE = `http://127.0.0.1:${PORT}`
const VIEWPORT = { width: 1440, height: 900 }

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

// --- prereqs -------------------------------------------------------------
if (!existsSync(join(DIST, 'index.html'))) die('app/dist not built — run `cd app && bun run build`')
const binCandidates = [
  join(REPO, 'app/src-tauri/binaries/infrakit-backend-x86_64-pc-windows-msvc.exe'),
  join(REPO, 'app/src-tauri/binaries/infrakit-backend-x86_64-unknown-linux-gnu'),
  join(REPO, 'app/src-tauri/binaries/infrakit-backend'),
]
const BIN = binCandidates.find(existsSync)
if (!BIN) die('sidecar binary not found — run `cd app && bun run build:sidecar`')
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
} catch {
  die('ffmpeg not on PATH — install it (winget install ffmpeg / apt install ffmpeg / brew install ffmpeg)')
}

mkdirSync(SHOTS, { recursive: true })
mkdirSync(VIDDIR, { recursive: true })

// --- backend ----------------------------------------------------------------
const dataDir = mkdtempSync(join(tmpdir(), 'ik-capture-'))
console.log('▶ starting backend…')
const be = spawn(BIN, ['--static-dir', DIST, '--auth', 'off', '--addr', `127.0.0.1:${PORT}`, '--data-dir', dataDir], {
  stdio: ['ignore', 'pipe', 'inherit'],
})
const token = await new Promise<string>((res, rej) => {
  const to = setTimeout(() => rej(new Error('backend did not announce LISTENING in 20s')), 20_000)
  let seenListening = false
  let tok = ''
  be.stdout.on('data', (b: Buffer) => {
    const s = b.toString()
    const m = s.match(/TOKEN\s+([0-9a-f]+)/)
    if (m) tok = m[1]
    if (s.includes('LISTENING')) seenListening = true
    if (seenListening && tok) {
      clearTimeout(to)
      res(tok)
    }
  })
  be.on('exit', (c) => rej(new Error(`backend exited early (code ${c})`)))
}).catch((e) => die(String(e)))

async function stopBackend() {
  be.kill()
  await new Promise((r) => setTimeout(r, 300))
  rmSync(dataDir, { recursive: true, force: true })
}

// --- browser -----------------------------------------------------------------
const browser = await chromium.launch()

/** A context pre-wired to talk to the local backend with no login. */
async function makeContext(opts: Parameters<typeof browser.newContext>[0] = {}) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: 'dark',
    deviceScaleFactor: 2,
    ...opts,
  })
  await ctx.addInitScript(
    ([url, tok]) => {
      try {
        localStorage.setItem('infrakit:backend-endpoint', JSON.stringify({ url, token: tok }))
      } catch {
        /* private mode / blocked — the client-only tools still work */
      }
    },
    [BASE, token] as const,
  )
  return ctx
}

const settle = (p: Page, ms = 600) => p.waitForTimeout(ms)

// --- screenshots -----------------------------------------------------------
type Shot = { name: string; path: string; wait?: number; setup?: (p: Page) => Promise<void> }

const type_ = async (p: Page, selector: string, text: string) => {
  await p.locator(selector).first().click()
  await p.keyboard.type(text, { delay: 8 })
}

const SHOT_LIST: Shot[] = [
  { name: '01-all-tools', path: '/' },
  {
    name: '02-chmod',
    path: '/tools/chmod-calculator',
    setup: async (p) => {
      // click a few permission checkboxes for a non-empty output
      const boxes = p.getByRole('checkbox')
      for (const i of [0, 1, 3, 6]) await boxes.nth(i).click().catch(() => {})
    },
  },
  {
    name: '03-docker-run',
    path: '/tools/docker-run-converter',
    setup: (p) =>
      type_(p, 'textarea', 'docker run -d --name web -p 8080:80 -e TZ=UTC -v ./html:/usr/share/nginx/html:ro --restart unless-stopped nginx:1.27'),
  },
  { name: '04-ssh-config', path: '/tools/ssh-config-builder' },
  {
    name: '05-regex',
    path: '/tools/regex-tester',
    setup: async (p) => {
      await type_(p, 'input[type="text"]', '(?<user>[\\w.]+)@(?<host>[\\w.-]+)')
      const ta = p.locator('textarea').first()
      await ta.click()
      await p.keyboard.type('alice@example.com\nbob.smith@infra.local\nnot-an-email', { delay: 4 })
    },
  },
  { name: '06-x509', path: '/tools/x509-inspector' },
  {
    name: '07-ping-monitor',
    path: '/tools/ping-monitor',
    wait: 13_000,
    setup: async (p) => {
      await type_(p, 'input#pm-hosts', '1.1.1.1; 8.8.8.8; 9.9.9.9')
      await p.getByRole('button', { name: 'Start' }).click()
    },
  },
  {
    name: '08-traceroute',
    path: '/tools/traceroute',
    wait: 7000,
    setup: async (p) => {
      await type_(p, 'input#tr-host', '1.1.1.1')
      await p.getByRole('button', { name: 'Trace', exact: true }).click()
    },
  },
  { name: '09-udp-traceroute', path: '/tools/udp-traceroute' },
  { name: '10-runbook', path: '/tools/runbook' },
  { name: '11-ansible', path: '/tools/ansible' },
  { name: '12-ai-hub', path: '/tools/ai' },
  { name: '13-prompt-library', path: '/tools/prompt-library' },
  { name: '14-formflow', path: '/tools/formflow-builder' },
  { name: '15-settings', path: '/settings' },
]

{
  const ctx = await makeContext()
  const page = await ctx.newPage()
  for (const s of SHOT_LIST) {
    process.stdout.write(`  ${s.name} … `)
    try {
      await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle', timeout: 20_000 })
      await settle(page)
      await s.setup?.(page).catch(() => {})
      await settle(page, s.wait ?? 700)
      await page.screenshot({ path: join(SHOTS, `${s.name}.png`) })
      console.log('ok')
    } catch (e) {
      console.log(`skip (${(e as Error).message.split('\n')[0]})`)
    }
  }
  await ctx.close()
}

// --- demo walkthrough → webm ------------------------------------------------
console.log('▶ recording walkthrough…')
let webm = ''
{
  const ctx = await makeContext({ recordVideo: { dir: VIDDIR, size: VIEWPORT }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  const step = async (fn: () => Promise<unknown>, pause = 1200) => {
    await fn()
    await p.waitForTimeout(pause)
  }

  // Warm-up: video recording starts the instant the context exists, so paint
  // the shell before the walkthrough proper (the leading frames are trimmed
  // in ffmpeg anyway, but this keeps the trim short).
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)

  await step(() => p.goto(`${BASE}/`, { waitUntil: 'networkidle' }), 2000)
  await step(() => p.goto(`${BASE}/tools/ping-monitor`, { waitUntil: 'networkidle' }), 1200)
  await step(() => type_(p, 'input#pm-hosts', '1.1.1.1; 8.8.8.8; 9.9.9.9'), 400)
  await step(() => p.getByRole('button', { name: 'Start' }).click(), 9000)
  await step(() => type_(p, 'input[placeholder="add a host…"]', 'one.one.one.one'), 300)
  await step(() => p.getByRole('button', { name: 'Add host' }).click(), 5000)
  await step(() => p.getByRole('button', { name: '8.8.8.8', exact: true }).click(), 2500) // legend toggle
  await step(() => p.goto(`${BASE}/tools/traceroute`, { waitUntil: 'networkidle' }), 900)
  await step(() => type_(p, 'input#tr-host', '1.1.1.1'), 300)
  await step(() => p.getByRole('button', { name: 'Trace', exact: true }).click(), 6000)
  await step(() => p.goto(`${BASE}/tools/ai`, { waitUntil: 'networkidle' }), 2600)
  await step(() => p.goto(`${BASE}/tools/runbook`, { waitUntil: 'networkidle' }), 2600)
  await step(() => p.goto(`${BASE}/tools/ansible`, { waitUntil: 'networkidle' }), 2600)
  await step(() => p.goto(`${BASE}/`, { waitUntil: 'networkidle' }), 1600)

  const v = p.video()
  await ctx.close()
  webm = v ? await v.path() : ''
}

await browser.close()
await stopBackend()

// --- ffmpeg: webm → mp4 + gif ---------------------------------------------
if (webm && existsSync(webm)) {
  console.log('▶ ffmpeg…')
  // Full walkthrough → mp4 (link-only on GitHub, good for articles/social).
  // -ss 1.5 drops the blank lead-in before the shell's first paint.
  const mp4 = join(ASSETS, 'demo.mp4')
  execFileSync('ffmpeg', [
    '-y', '-ss', '1.5', '-i', webm,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow',
    '-movflags', '+faststart',
    mp4,
  ], { stdio: 'ignore' })
  // A short, light GIF for inline README embedding — first GIF_SECS, sped up,
  // 10 fps, narrower. Kept well under ~3 MB so the README loads fast.
  const GIF_SECS = 24
  execFileSync('ffmpeg', [
    '-y', '-t', String(GIF_SECS), '-i', mp4,
    '-vf', 'setpts=0.7*PTS,fps=9,scale=680:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer',
    '-loop', '0',
    join(ASSETS, 'demo.gif'),
  ], { stdio: 'ignore' })
  rmSync(webm, { force: true })
  console.log('  docs/assets/demo.mp4 + demo.gif')
} else {
  console.log('✗ no walkthrough video was recorded')
}

console.log('\n✓ done — docs/assets/')
