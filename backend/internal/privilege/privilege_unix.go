//go:build !windows

package privilege

import "os"

func isElevated() bool {
	return os.Geteuid() == 0
}
