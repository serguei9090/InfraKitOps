//go:build windows

package lldp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/infrakit/backend/internal/privilege"
)

func captureMethod() string { return "pktmon" }

// CaptureAvailable reports whether an LLDP/CDP capture can run here.
func CaptureAvailable() (bool, string) {
	if _, err := exec.LookPath("pktmon.exe"); err != nil {
		return false, "pktmon isn't available — needs Windows 10 1809+ / Server 2019+"
	}
	if !privilege.IsElevated() {
		return false, "LLDP/CDP capture needs the backend running as administrator (pktmon)"
	}
	return true, ""
}

func pk(ctx context.Context, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, "pktmon.exe", args...).CombinedOutput()
}

func captureImpl(
	ctx context.Context, iface string, window time.Duration,
	onFrame func(iface string, frame []byte), _ func(Neighbor), emit Emit,
) error {
	if ok, reason := CaptureAvailable(); !ok {
		return fmt.Errorf("%w: %s", ErrUnsupported, reason)
	}

	tmp, err := os.MkdirTemp("", "infrakit-lldp-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	etl := filepath.Join(tmp, "cap.etl")
	pcapng := filepath.Join(tmp, "cap.pcapng")

	// our filters: LLDP by ethertype, CDP by the well-known multicast MAC
	_, _ = pk(ctx, "filter", "remove")
	if out, ferr := pk(ctx, "filter", "add", "IK-LLDP", "-d", "0x88CC"); ferr != nil {
		return fmt.Errorf("pktmon filter (LLDP): %s", string(out))
	}
	_, _ = pk(ctx, "filter", "add", "IK-CDP", "-m", "01-00-0C-CC-CC-CC")
	defer func() { _, _ = pk(context.Background(), "filter", "remove") }()

	if out, serr := pk(ctx, "start", "--capture", "--pkt-size", "0", "--file-name", etl); serr != nil {
		return fmt.Errorf("pktmon start: %s", string(out))
	}

	emit("note", "listening for LLDP/CDP (LLDP interval 30s, CDP 60s)…")
	left := int(window.Seconds())
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
loop:
	for left > 0 {
		select {
		case <-ctx.Done():
			break loop
		case <-tick.C:
			left--
			emit("tick", left)
		}
	}

	_, _ = pk(context.Background(), "stop")
	if out, cerr := pk(context.Background(), "etl2pcap", etl, "-o", pcapng); cerr != nil {
		return fmt.Errorf("pktmon etl2pcap: %s", string(out))
	}

	f, err := os.Open(pcapng)
	if err != nil {
		return err
	}
	defer f.Close()
	return ReadPcapngFrames(f, func(ifn string, frame []byte) {
		if iface == "" || ifn == "" || ifn == iface {
			onFrame(ifn, frame)
		}
	})
}
