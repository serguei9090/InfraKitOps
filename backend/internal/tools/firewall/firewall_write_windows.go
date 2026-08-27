//go:build windows

package firewall

import (
	"encoding/json"

	"github.com/infrakit/backend/internal/elevate"
	"github.com/infrakit/backend/internal/fwspec"
)

func applyElevated(c fwspec.Change) error {
	payload, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return elevate.Run(elevate.Request{Op: "firewall-exec", Content: string(payload)})
}
