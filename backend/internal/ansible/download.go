package ansible

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// pinnedUbuntuWSLRootfs is Canonical's official Ubuntu WSL rootfs — used to
// `wsl --import` a dedicated InfraKit-Ansible distro when the user gives no
// source. Recorded in vendor-tools/TOOLS.md. Ubuntu's own licensing; fetched on
// demand, never bundled in the installer.
const pinnedUbuntuWSLRootfs = "https://cloud-images.ubuntu.com/wsl/noble/current/ubuntu-noble-wsl-amd64-ubuntu.rootfs.tar.gz"

// downloadTemp streams url to a temp file, emitting progress. Caller removes it.
func downloadTemp(ctx context.Context, url string, emit func(string)) (string, error) {
	emit("Downloading " + url + " …")
	c, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	req, _ := http.NewRequestWithContext(c, http.MethodGet, url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: %s", url, resp.Status)
	}

	f, err := os.CreateTemp("", "infrakit-wsl-rootfs-*.tar.gz")
	if err != nil {
		return "", err
	}
	// 2 GiB cap — a rootfs is ~30-300 MiB.
	n, err := io.Copy(f, io.LimitReader(resp.Body, 2<<30))
	_ = f.Close()
	if err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	emit(fmt.Sprintf("Downloaded %d MiB", n>>20))
	return f.Name(), nil
}
