//go:build !windows

package firewall

import "github.com/infrakit/backend/internal/fwspec"

func applyElevated(_ fwspec.Change) error { return ErrWriteUnsupported }
