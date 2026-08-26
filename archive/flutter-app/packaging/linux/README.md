# Linux packaging — status: untested

Written on a Windows-only dev machine with no Linux environment available to
build or run these against. The `.deb` and AppImage scripts follow standard,
well-documented packaging conventions and mirror the already-verified Windows
pipeline (`packaging/windows/`), but **none of this has actually been run**.
Treat it as a strong first draft, not a verified release artifact.

## What to verify before trusting this

1. `chmod +x build_deb.sh build_appimage.sh AppRun` (git/zip transfers from
   Windows can drop the executable bit).
2. `flutter build linux` actually succeeds on the target machine (needs
   `clang`, `cmake`, `ninja-build`, `pkg-config`, and GTK 3 dev headers —
   see Flutter's own Linux desktop setup docs if that build step fails).
3. `./build_deb.sh`, then `sudo apt install ./build/installer/*.deb`,
   then confirm `infrakit-studio` (GUI) and
   `infrakit-studio --serve --port 8080` (headless, curl `localhost:8080`)
   both work post-install, then `sudo apt remove infrakit-studio` cleanly
   removes it.
4. `appimagetool` on PATH (see the comment at the top of
   `build_appimage.sh` for where to get it), then
   `./build_appimage.sh`, then run the resulting `.AppImage` directly (no
   install step needed) and confirm the same GUI/--serve behavior.

## Why this should work in principle

- The Linux native runner (`linux/my_application.cc`) already has the same
  `--serve` headless-mode patch as Windows (see `README.md`'s architecture
  section) — verified via code review, not a Linux run, but it's the same
  `argv` check + "don't connect the first-frame-shows-the-window signal"
  technique already proven working on Windows.
- Flutter's Linux embedder resolves `data/`/`lib/` relative to the
  executable's own directory, which is why both scripts keep the whole
  bundle (binary + libs + data + the copied-in `web/` folder) together in
  one directory rather than splitting across FHS `usr/lib`/`usr/share` —
  this is the standard, documented way other projects package Flutter Linux
  apps, not something invented here.
