# Bundled third-party tools

Binaries invoked by the Go backend via `exec` (never linked). Downloaded and
SHA-256-verified by `fetch-tools.sh` / `.ps1` from the pins in
[`tools.lock`](tools.lock); `build-sidecar` copies them next to the backend as
`<tool>-<target-triple>`.

**License gate** (see `CLAUDE.md`): a binary may be bundled in the installer only
if it is MIT / BSD-2/3-Clause / ISC / Apache-2.0 / MPL-2.0. No GPL/LGPL bundling.
No NPSL (nmap).

| Tool | Version | SPDX | Bundled for | Source | Why not a Go library |
|------|---------|------|-------------|--------|----------------------|
| **iperf3** | 3.21 | BSD-3-Clause | linux/amd64, linux/arm64, darwin/amd64, darwin/arm64 | [userdocs/iperf3-static](https://github.com/userdocs/iperf3-static) (build repo MIT; binary BSD-3, static musl — no libc/OpenSSL/Cygwin deps) | No trustworthy protocol-compatible pure-Go implementation exists; `iperf3 --json` is the interface. |

## Windows: iperf3 is **not bundled**

Every Windows iperf3 build (esnet, ar51an, …) links **`cygwin1.dll`**, which is
GPLv3 + a linking exception *conditioned on the calling program being open
source*. That fails the license gate, so on Windows the backend looks for
`iperf3` on `PATH` and, if absent, the UI shows:

```
winget install ar51an.iPerf3
```

(one command; `ar51an.iPerf3` 3.21 is in the winget default source). `choco
install iperf3` and a manual download also work.

## Adding a tool

1. Confirm the license is in the gate list.
2. Add rows to `tools.lock` (one per goos/goarch) with the pinned SHA-256.
3. Add a table row here with the "why not a library" justification.
4. `./fetch-tools.sh` then `../backend/build-sidecar.sh`.
