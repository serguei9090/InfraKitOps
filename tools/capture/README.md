# tools/capture

Regenerates the images in [`docs/assets/`](../../docs/assets/) — one PNG per
key screen plus a short demo clip (`demo.mp4` + `demo.gif`) — by driving the
real built app in headless Chromium.

Isolated from `app/` on purpose: Playwright's ~150 MB browser download never
touches the app's `bun install`.

## Run

```bash
# once, from the repo root — the script needs the built frontend + sidecar:
cd app && bun run build && bun run build:sidecar && cd ..

cd tools/capture
bun install          # pulls playwright + downloads chromium (first time only)
bun run capture
```

Also needs **ffmpeg** on `PATH` (`winget install ffmpeg` / `apt install ffmpeg`
/ `brew install ffmpeg`).

## What it does

1. Serves `app/dist` + the API from one origin via `infrakit-backend
   --static-dir … --auth off` — the same code path as a hosted deployment.
2. Reads the per-launch bearer token off the backend's stdout and injects it
   as the `infrakit:backend-endpoint` localStorage override, so the web build
   talks to its own API with no login screen.
3. Screenshots each route in `SHOT_LIST` (edit that array to add/remove
   screens), then records one scripted walkthrough.
4. ffmpeg turns the walkthrough `.webm` into `docs/assets/demo.mp4` + `.gif`.

Screens that need live data (ping, traceroute) are captured against your real
network, so those shots vary run to run — that's fine for a showcase.

## Committing the output

Commit a **curated** subset of `docs/assets/screenshots/*.png` + `demo.gif` +
`demo.mp4` — not necessarily every file the script produces. Regenerating all
of them on every change permanently bloats git history.

Reference them:

- **In this repo's README** — relative path: `![demo](docs/assets/demo.gif)`
- **In external articles** — jsDelivr CDN, pinned to a tag so a published
  article doesn't break on the next regen:
  `https://cdn.jsdelivr.net/gh/serguei9090/InfraKitOps@v0.5.0/docs/assets/demo.gif`
