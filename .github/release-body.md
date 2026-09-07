## Install

### Desktop

Download the installer for your OS below, install, and run — a local backend
starts automatically, no configuration, single-user.

| OS | File |
|----|------|
| Windows | `.msi` (or `_x64-setup.exe` for the NSIS installer) |
| Linux | `.deb` (Debian / Ubuntu) or `.AppImage` (portable) |

The builds are **not code-signed** yet, so Windows SmartScreen shows an
"unknown publisher" prompt once — *More info → Run anyway*.

### Self-hosted (team, multi-user)

One line with Docker:

```bash
docker run -p 8080:8080 -v infrakit:/data ghcr.io/serguei9090/infrakitops:latest
```

Or grab `infrakit-studio-web-<version>-<os>.zip` below — the same backend
binary serves the UI and the API on one port:

```bash
unzip infrakit-studio-web-<version>-linux-amd64.zip -d infrakit
cd infrakit && ./run.sh          # Windows: run.bat
```

Open <http://127.0.0.1:8080>; the first start logs a `SETUP-TOKEN` for
creating the admin account. To expose it on a network, put TLS in front —
`deploy/compose.yml` (Caddy) and `docs/deployment/DEPLOY.md` in the repo.

### Try before you install

Client-only tools run in the browser at the
[live demo](https://serguei9090.github.io/InfraKitOps/).
