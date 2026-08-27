# Tool Strategy Review — whole project (2026-08-27)

Answers the question: *now that a Go backend exists, is each tool's current
implementation the right one, or would a Go library / CLI wrapper be better?*

Scope: all 44 tools across the 7 modules in
[`moduleTaxonomy.ts`](app/src/adapters/ui/shell/moduleTaxonomy.ts). Applies the
three-tier rule and the bundled-binary license gate from
[`CLAUDE.md`](CLAUDE.md).

## Bottom line

**~85% of tools are correctly pure client-side computation** — string
templating, CIDR math, hashing, parsing, format conversion. A CLI or backend
adds nothing to these; the hexagonal `src/core/**` rule is doing its job.
Leave them alone.

**Backend opportunity clusters in 4 buckets**, ranked by value:

| # | Bucket | Tools | Approach | License | Effort |
|---|--------|-------|----------|---------|--------|
| 1 | **PDF engine swap** | pdf-split-merge, pdf-inspector | replace `pdf-lib` with **`pdfcpu`** (pure Go) in the backend | Apache-2.0 ✅ tier 1 | ~2–3 pd, ~400 LOC |
| 2 | **Config validation** | 5 config builders | one `POST /config/validate` endpoint that shells to the matching `-t` / check-mode validator *if installed* | OS built-ins ✅ tier 2 | ~2 pd, ~350 LOC |
| 3 | **Key generation** | ssh-keygen | add RSA-2048/3072/4096 + ECDSA + passphrase via Go stdlib (`crypto/rsa`, `crypto/ecdsa`, `x/crypto/ssh`) | BSD-3 ✅ tier 1 | ~1.5 pd, ~250 LOC |
| 4 | **Robust decode / live fetch** | qr-reader, x509-inspector | `gozxing` for QR; `crypto/x509` + `tls.Dial` for "inspect live host:443" | Apache-2.0 / BSD ✅ tier 1 | ~2 pd, ~300 LOC |

Total if all four done: ~8–10 pd, ~1.3k LOC. **#1 and #2 are the ones worth
scheduling** — the rest are quality-of-life.

Everything stays **client-first**: the browser path remains the default and
works with no backend; the backend is an optional "power mode" that lights up
when the sidecar/service is present, exactly like the Network module.

---

## Module 1 — Tuning & Performance

| Tool | Now | Verdict |
|------|-----|---------|
| Linux Kernel Sysctl | heuristic math over user inputs | **KEEP** — no tool computes this; upstream equivalents are also just JS |
| Ceph PG Calculator | power-of-2 rounding math | **KEEP** — the canonical calculator is a static web page |
| Database RAM Sizer | buffer-sizing heuristics | **KEEP** — PGTune itself is client-side JS |
| Monitoring Sizing (Zabbix) | NVPS / poller math | **KEEP** |
| Firewall Command Builder | emits iptables / cloud one-liner strings | **KEEP** — a builder, offline by design |

Nothing to do here.

## Module 2 — Daily Developer & Utilities

| Tool | Now | Verdict |
|------|-----|---------|
| **SSH Key Pair Generator** | Ed25519 via `@noble/curves`; **RSA-4096 throws** ([`sshKeyGenerator.ts:74`](app/src/core/utility/sshKeyGenerator.ts)) | **BUCKET 3** — backend adds RSA / ECDSA / encrypted keys via Go stdlib. Client Ed25519 stays the zero-dep default |
| Hash & Checksum | `@noble/hashes` + `crypto-js` | **KEEP** — correct and fast |
| bcrypt Hash & Verify | `bcryptjs` | **KEEP** — Go `x/crypto/bcrypt` is only marginally faster; not worth it |
| Data Converter | `js-yaml` / `smol-toml` / `fast-xml-parser` | **KEEP** — `yq` (MIT) would add nothing |
| Formatters (JSON/XML/YAML/SQL) | pure libs + hand-rolled SQL | **KEEP** |
| UUID / ULID Generator | `uuid` + `ulidx` | **KEEP** |
| Password & Secret Generator | Web Crypto RNG | **KEEP** |
| Regex Tester & Explainer | JS `RegExp` + explainer | **KEEP** — JS-flavor only; a CLI would only help if targeting PCRE/RE2 specifically (future note, not now) |
| Text & JSON Diff | `diff` (LCS) | **KEEP** |
| JSONPath Evaluator | hand-rolled | **KEEP** |
| JWT Parser | decode only, no sig verify | **KEEP** — adding HS/RS verify is a feature, not a CLI question |
| **X.509 Certificate Inspector** | `jsrsasign` parse of pasted PEM/DER | **BUCKET 4** — Go `crypto/x509` parses extensions far more completely, and a backend can `tls.Dial` a live `host:443` to fetch + chain-validate its cert. Paste-a-PEM stays client-side |
| JSON/YAML Tree Viewer | pure UI | **KEEP** |
| GZip Compress / Decompress | `pako` | **KEEP** — Go could add zstd/brotli/xz but that's a feature request |
| Base64 File Converter | pure | **KEEP** |
| JSON → CSV | pure flatten | **KEEP** |
| Text Transformer | pure | **KEEP** |
| MAC Address Tool | normalize + bits + OUI vendor lookup | **KEEP** — a backend could ship the full IEEE OUI file instead of a bundled subset; minor |
| IPv4 Range & IPv6 ULA | CIDR math | **KEEP** |
| htpasswd / Basic Auth Generator | `bcryptjs` + `crypto-js` (APR1/SHA) | **KEEP** — the `htpasswd` CLI adds nothing; APR1-MD5 already implemented |

## Module 3 — Network Toolkit

All 17 already run on the Go backend (per
[`NETWORK_MODULE_PLAN.md`](NETWORK_MODULE_PLAN.md)). Reviewing the *approach*
chosen inside each:

| Tool | Backend approach | Verdict |
|------|------------------|---------|
| Subnet Calculator | pure client (by design — the one no-backend tool) | **KEEP** |
| DNS Lookup | `miekg/dns` | **KEEP** — better than shelling to `dig` |
| SNTP Lookup | `beevik/ntp` | **KEEP** |
| Whois | `likexian/whois` + parser | **KEEP** — parser coverage varies by TLD, acceptable |
| IP Geolocation | `oschwald/geoip2-golang` + MaxMind DB | **KEEP** — offline-DB shipping is the open follow-up, not the approach |
| Connections & Listeners | `gopsutil` | **KEEP** — better than parsing `netstat`/`ss` |
| Wake on LAN | raw UDP magic packet | **KEEP** |
| Ping Monitor | per-OS unprivileged ICMP (`IcmpSendEcho` / `pro-bing`) | **KEEP** — correctly avoids raw sockets / root |
| Traceroute | per-OS ICMP + TTL | **KEEP** — `mtr` correctly rejected (GPL); compose ping + traceroute instead |
| Port Scanner | concurrent TCP connect | **KEEP** — SYN scan would need `naabu` (MIT), already noted as deferred |
| IP / Network Scanner | ICMP + rDNS + port probe | **KEEP** — ARP discovery needs pcap, correctly deferred to N4 |
| Neighbor Table | `Get-NetNeighbor` / `ip -j neigh` JSON | **KEEP** — just upgraded from `arp -a` parsing |
| Hosts File Editor | direct r/w + elevated helper on `EACCES` | **KEEP** |
| Firewall Viewer | `netsh` verbose parse / `firewalld`+`ufw`+`nft -j` | **KEEP** — write CRUD is correctly its own future release |
| iperf3 Throughput | bundled static BSD-3 binary (Linux/mac), winget (Windows — cygwin GPL blocks bundling) | **KEEP** — just extended with more UI options + raw-args passthrough |
| SNMP | `gosnmp` | **KEEP** |
| Discovery Protocol (LLDP/CDP) | not implemented — needs pcap/CGO/Npcap | **KEEP** deferral (N4) |

No changes. The Network module's tier choices are already right.

## Module 4 — Office & Media

| Tool | Now | Verdict |
|------|-----|---------|
| **PDF Split & Merge** | `pdf-lib` (split/merge/rotate) | **BUCKET 1** — `pdfcpu` (pure Go, Apache-2.0) does split/merge plus optimize, encrypt/decrypt, stamp, repair, validate, and is much faster on large files |
| **PDF Inspector** | `pdf-lib` metadata | **BUCKET 1** — fold into the same `pdfcpu` backend: validation, encryption details, object/stream stats |
| Image Converter | Canvas `toBlob` — JPEG/PNG/WebP, quality only, no AVIF, no PNG effort | **OPTIONAL (low priority)** — a backend using Go `x/image` handles batch jobs, large files, and formats Canvas can't. `ffmpeg` (LGPL/GPL) and `libvips` (LGPL) fail the license gate; ImageMagick's license passes but the binary is heavy. Keep Canvas as default |
| EXIF Metadata Viewer | `exifr` | **KEEP** — comprehensive; `exiftool` is GPL/Artistic, avoid |
| QR Code Suite (generate) | `qrcode` | **KEEP** |
| **QR Code Reader (decode)** | `jsqr` — unmaintained, weak on rotated / low-contrast | **BUCKET 4** — `gozxing` (pure Go, Apache-2.0) decodes far more robustly and covers other barcode symbologies. `jsqr` stays the client default. `zbar` is LGPL — do not bundle |
| Color Tools | pure math | **KEEP** |

## Module 5 — FormFlow Dynamic Builder

| Tool | Now | Verdict |
|------|-----|---------|
| XML/YAML Form Designer | `react-hook-form` `useFieldArray` + parsers | **KEEP** — pure client is the entire point of this feature; a backend would defeat it |

## Module 6 — Configuration Builders

Every tool here emits a config-file string and is offline by design — **keep
all the generators client-side.** The single shared opportunity:

> **BUCKET 2 — `POST /api/v1/config/validate { kind, text }`**
> Backend writes the text to a temp file and runs the matching validator in
> **check-only mode** (never applies anything), returns `{ ok, messages[] }`.
> Only runs when the relevant tool is on `PATH`; otherwise the UI shows
> "install X to validate here". One endpoint covers five builders. Low risk
> (no writes to real config), high value (catches syntax errors before the
> user pastes into production).

| Tool | Now | Validator it would call |
|------|-----|-------------------------|
| SSH Config Builder | emits `ssh_config` / `sshd_config` | `sshd -t -f <file>`, `ssh -G` |
| Kernel Parameter Config Builder | emits `sysctl.conf` | `sysctl -p --dry-run <file>` (Linux) |
| Firewall Rule Builder | emits UFW / nftables | `nft -c -f <file>` (check, no apply) |
| Web Server Config Builder | emits nginx / Apache | `nginx -t -c <file>`, `apachectl configtest` |
| Fail2ban Jail Config Builder | emits `jail.local` | `fail2ban-client -t` |
| Docker Run → Compose | parse `docker run` → YAML | *(none — `docker compose config` needs a full daemon; skip)* |
| Crontab Builder | cron parse + next-run | **KEEP** — already validates |
| Chmod Calculator | octal ⟷ symbolic | **KEEP** |
| Database Config Builder | emits `postgresql.conf` / `my.cnf` | *(no lightweight offline validator — skip)* |
| Zabbix Config Builder | emits from directive catalog | *(`zabbix_server -T` needs the full package — optional, low priority)* |

## Module 7 — Knowledge Hub

| Tool | Verdict |
|------|---------|
| Cheatsheets, Documentation, Reference Lists, Study & Practice | **KEEP** — static content and curated link lists |

---

## Recommended sequencing

1. **PDF → pdfcpu** (Bucket 1). Clean pure-Go dependency swap, real
   user-facing capability gap (encryption, repair, optimize), no bundled
   binary, passes the license gate outright.
2. **`/config/validate`** (Bucket 2). Small, low-risk, check-only; makes five
   existing tools meaningfully better.
3. **ssh-keygen RSA/ECDSA** (Bucket 3). Closes the one hard `throw` in the
   utilities module.
4. **gozxing + live-cert fetch** (Bucket 4). Quality-of-life; do when touching
   those screens for other reasons.

## License gate check (for the tools named above)

| Component | License | Bundle? |
|-----------|---------|---------|
| `pdfcpu` (Go dep) | Apache-2.0 | ✅ pure Go, no binary |
| `gozxing` (Go dep) | Apache-2.0 | ✅ pure Go |
| Go stdlib `crypto/*`, `golang.org/x/crypto`, `golang.org/x/image` | BSD-3 | ✅ |
| `qpdf` (if ever preferred over pdfcpu) | Apache-2.0 (v2+) | ✅ but a C++ binary — prefer pdfcpu |
| `ffmpeg` | LGPL-2.1+ / GPL | ❌ do not bundle |
| `libvips`, `zbar` | LGPL-2.1 | ❌ do not bundle (LGPL excluded by CLAUDE.md) |
| `exiftool` | GPL / Artistic | ❌ |
| `nginx -t`, `sshd -t`, `nft -c`, `fail2ban-client -t`, `sysctl` | OS built-ins | ✅ detect on PATH, never bundle |
