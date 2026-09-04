// Package backup makes consistent, hot snapshots of the SQLite state + the
// vault blob without a CLI or a stop (POLISH_PLAN.md PL1).
//
// Each `*.db` under the data dir is copied with `VACUUM INTO`, which writes a
// transactionally-consistent copy even while writers are active. `vault.enc`
// is copied verbatim (it's an at-rest encrypted file, rewritten atomically by
// the vault). The set is tar+gzip'd with a manifest.
package backup

import (
	"archive/tar"
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const archivePrefix = "infrakit-backup-"

// Manifest lists what an archive contains.
type Manifest struct {
	CreatedAt string   `json:"createdAt"`
	Version   string   `json:"version"`
	Files     []string `json:"files"`
}

// Snapshot writes infrakit-backup-<RFC3339>.tgz into outDir and returns its
// path. dataDir is scanned for `*.db` and `vault.enc`.
func Snapshot(dataDir, outDir, version string) (string, error) {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return "", err
	}
	work, err := os.MkdirTemp(outDir, ".snap-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(work)

	var files []string

	dbs, _ := filepath.Glob(filepath.Join(dataDir, "*.db"))
	sort.Strings(dbs)
	for _, src := range dbs {
		name := filepath.Base(src)
		dst := filepath.Join(work, name)
		if err := vacuumInto(src, dst); err != nil {
			return "", fmt.Errorf("snapshot %s: %w", name, err)
		}
		files = append(files, name)
	}

	vault := filepath.Join(dataDir, "vault.enc")
	if _, err := os.Stat(vault); err == nil {
		if err := copyFile(vault, filepath.Join(work, "vault.enc")); err != nil {
			return "", fmt.Errorf("snapshot vault.enc: %w", err)
		}
		files = append(files, "vault.enc")
	}
	// per-user vaults, if any
	if perUser, _ := filepath.Glob(filepath.Join(dataDir, "vault", "*.enc")); len(perUser) > 0 {
		_ = os.MkdirAll(filepath.Join(work, "vault"), 0o755)
		for _, src := range perUser {
			rel := filepath.Join("vault", filepath.Base(src))
			if err := copyFile(src, filepath.Join(work, rel)); err != nil {
				return "", err
			}
			files = append(files, filepath.ToSlash(rel))
		}
	}

	if len(files) == 0 {
		return "", fmt.Errorf("nothing to back up under %s", dataDir)
	}

	man := Manifest{CreatedAt: time.Now().UTC().Format(time.RFC3339), Version: version, Files: files}
	manBuf, _ := json.MarshalIndent(man, "", "  ")
	if err := os.WriteFile(filepath.Join(work, "manifest.json"), manBuf, 0o644); err != nil {
		return "", err
	}

	now := time.Now().UTC()
	ts := now.Format("20060102T150405") + fmt.Sprintf(".%03dZ", now.Nanosecond()/1_000_000)
	archive := filepath.Join(outDir, archivePrefix+ts+".tgz")
	if err := tarGz(work, archive); err != nil {
		return "", err
	}
	return archive, nil
}

// Prune keeps the newest `keep` archives in outDir, deletes the rest. keep<=0
// disables pruning.
func Prune(outDir string, keep int) error {
	if keep <= 0 {
		return nil
	}
	entries, err := filepath.Glob(filepath.Join(outDir, archivePrefix+"*.tgz"))
	if err != nil {
		return err
	}
	if len(entries) <= keep {
		return nil
	}
	sort.Strings(entries) // timestamped names sort chronologically
	for _, old := range entries[:len(entries)-keep] {
		_ = os.Remove(old)
	}
	return nil
}

func vacuumInto(src, dst string) error {
	db, err := sql.Open("sqlite", "file:"+src+"?_pragma=busy_timeout(10000)&mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	// VACUUM INTO cannot use a bound parameter for the path.
	_, err = db.Exec("VACUUM INTO '" + strings.ReplaceAll(dst, "'", "''") + "'")
	return err
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func tarGz(srcDir, archive string) error {
	out, err := os.Create(archive)
	if err != nil {
		return err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	return filepath.Walk(srcDir, func(path string, fi os.FileInfo, err error) error {
		if err != nil || fi.IsDir() {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		h, err := tar.FileInfoHeader(fi, "")
		if err != nil {
			return err
		}
		h.Name = filepath.ToSlash(rel)
		if err := tw.WriteHeader(h); err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
}
