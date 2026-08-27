package configcheck

import (
	"context"
	"os/exec"
	"runtime"
	"testing"
)

func TestUnknownKind(t *testing.T) {
	res, err := Validate(context.Background(), "bogus", "x")
	if err != nil {
		t.Fatal(err)
	}
	if res.OK || len(res.Messages) == 0 {
		t.Fatalf("expected a not-ok result with a message, got %+v", res)
	}
}

func TestLinuxOnlyReportsUnavailableElsewhere(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("linux: nft may actually be present")
	}
	res, err := Validate(context.Background(), NFTables, "table inet t {}")
	if err != nil {
		t.Fatal(err)
	}
	if res.Available {
		t.Errorf("nftables should be unavailable on %s", runtime.GOOS)
	}
}

func TestParseMessages(t *testing.T) {
	raw := "nginx: [emerg] unknown directive \"proxy_pas\" in /x/snippet.conf:4\n" +
		"nginx: configuration file test failed\n" +
		"the configuration file syntax is ok"
	msgs := parseMessages(raw)
	if len(msgs) != 3 {
		t.Fatalf("want 3 messages, got %d: %+v", len(msgs), msgs)
	}
	if msgs[0].Level != "error" || msgs[0].Line != 4 {
		t.Errorf("first message: want error@4, got %+v", msgs[0])
	}
	if hasError([]Message{{Level: "info"}}) {
		t.Error("info-only should not count as error")
	}
	if !hasError(msgs) {
		t.Error("expected hasError=true for the nginx failure output")
	}
}

func TestSSHConfigValidatorWhenPresent(t *testing.T) {
	if _, err := exec.LookPath("ssh"); err != nil {
		t.Skip("ssh not on PATH")
	}
	ctx := context.Background()

	good, err := Validate(ctx, SSHConf, "Host example\n  HostName example.com\n  User me\n")
	if err != nil {
		t.Fatal(err)
	}
	if !good.Available {
		t.Fatal("ssh should be available")
	}
	if !good.OK {
		t.Errorf("valid ssh_config reported not ok: %+v", good)
	}

	bad, err := Validate(ctx, SSHConf, "ThisIsNotARealOption yes\n")
	if err != nil {
		t.Fatal(err)
	}
	if bad.OK {
		t.Errorf("invalid ssh_config reported ok: %+v", bad)
	}
}
