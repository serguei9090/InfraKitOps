package wol

import "testing"

func TestSendRejectsBadMAC(t *testing.T) {
	for _, bad := range []string{"", "zz", "00:11:22:33:44", "gg:11:22:33:44:55"} {
		if _, err := Send(bad, "255.255.255.255", 9); err == nil {
			t.Errorf("Send(%q) accepted a bad MAC", bad)
		}
	}
}

func TestSendBuildsAndBroadcasts(t *testing.T) {
	for _, mac := range []string{"00:11:22:33:44:55", "00-11-22-33-44-55", "001122334455"} {
		res, err := Send(mac, "255.255.255.255", 9)
		if err != nil {
			t.Fatalf("Send(%q): %v", mac, err)
		}
		if res.BytesSent != 102 {
			t.Fatalf("Send(%q) sent %d bytes, want 102", mac, res.BytesSent)
		}
		if res.MAC != "00:11:22:33:44:55" {
			t.Fatalf("Send(%q) normalized to %q", mac, res.MAC)
		}
	}
}

func TestNormalizeMAC(t *testing.T) {
	if got := normalizeMAC("001122334455"); got != "00:11:22:33:44:55" {
		t.Fatalf("normalizeMAC bare = %q", got)
	}
	if got := normalizeMAC("00-11-22-33-44-55"); got != "00:11:22:33:44:55" {
		t.Fatalf("normalizeMAC dashed = %q", got)
	}
}
