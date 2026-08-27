package firewall

import (
	"fmt"
	"runtime"

	"github.com/infrakit/backend/internal/fwspec"
)

// Write CRUD for the OS firewall. v1 is Windows-only (netsh advfirewall has a
// proper named-rule model); the Linux managers (ufw / firewalld / nft) don't
// map cleanly onto the normalized Rule shape for delete/toggle and are
// deferred. See NETWORK_MODULE_PLAN.md §1.2.

// ErrWriteUnsupported is returned for platforms/backends without write support.
var ErrWriteUnsupported = fmt.Errorf("firewall rule editing is only supported on Windows in this release")

// Apply validates and applies one change, escalating to the elevated helper
// (one UAC prompt). Windows only.
func Apply(c fwspec.Change) error {
	if runtime.GOOS != "windows" {
		return ErrWriteUnsupported
	}
	if _, err := fwspec.NetshArgs(c); err != nil {
		return err
	}
	return applyElevated(c)
}
