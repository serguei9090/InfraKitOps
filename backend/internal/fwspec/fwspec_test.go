package fwspec

import (
	"strings"
	"testing"
)

func TestValidateRejectsInjection(t *testing.T) {
	bad := []RuleSpec{
		{Name: `x" & calc.exe`, Direction: "inbound", Action: "allow", Protocol: "tcp", LocalPort: "80"},
		{Name: "ok", Direction: "sideways", Action: "allow", Protocol: "tcp"},
		{Name: "ok", Direction: "inbound", Action: "drop", Protocol: "tcp"},
		{Name: "ok", Direction: "inbound", Action: "allow", Protocol: "icmp"},
		{Name: "ok", Direction: "inbound", Action: "allow", Protocol: "tcp", LocalPort: "80; rm -rf"},
		{Name: "ok", Direction: "inbound", Action: "allow", Protocol: "tcp", RemoteAddr: "10.0.0.0/8 evil"},
		{Name: strings.Repeat("a", 200), Direction: "inbound", Action: "allow", Protocol: "tcp"},
	}
	for i, r := range bad {
		if err := r.Validate(OpAdd); err == nil {
			t.Errorf("case %d: expected %+v to be rejected", i, r)
		}
	}
}

func TestValidateAcceptsPlainRules(t *testing.T) {
	ok := []RuleSpec{
		{Name: "Allow HTTPS", Direction: "inbound", Action: "allow", Protocol: "tcp", LocalPort: "443"},
		{Name: "Ports", Direction: "outbound", Action: "block", Protocol: "udp", LocalPort: "1000-2000,3000"},
		{Name: "Any", Direction: "inbound", Action: "allow", Protocol: "any"},
		{Name: "From subnet", Direction: "inbound", Action: "allow", Protocol: "tcp", LocalPort: "22", RemoteAddr: "10.0.0.0/8"},
	}
	for i, r := range ok {
		if err := r.Validate(OpAdd); err != nil {
			t.Errorf("case %d: %+v rejected: %v", i, r, err)
		}
	}
}

func TestNetshArgs(t *testing.T) {
	add, err := NetshArgs(Change{Op: OpAdd, Rule: RuleSpec{
		Name: "Allow HTTPS", Direction: "inbound", Action: "allow", Protocol: "tcp", LocalPort: "443", RemoteAddr: "10.0.0.0/8",
	}})
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(add, " ")
	for _, want := range []string{"advfirewall firewall add rule", "name=Allow HTTPS", "dir=in", "action=allow", "protocol=TCP", "localport=443", "remoteip=10.0.0.0/8"} {
		if !strings.Contains(got, want) {
			t.Errorf("add args %q missing %q", got, want)
		}
	}

	del, _ := NetshArgs(Change{Op: OpDelete, Rule: RuleSpec{Name: "Allow HTTPS"}})
	if strings.Join(del, " ") != "advfirewall firewall delete rule name=Allow HTTPS" {
		t.Errorf("delete args = %v", del)
	}

	off, _ := NetshArgs(Change{Op: OpSetEnabled, Rule: RuleSpec{Name: "R", Enabled: false}})
	if strings.Join(off, " ") != "advfirewall firewall set rule name=R new enable=no" {
		t.Errorf("set-enabled args = %v", off)
	}
}

func TestAssessLockout(t *testing.T) {
	if w := AssessLockout(Change{Op: OpAdd, Rule: RuleSpec{
		Name: "Block SSH", Direction: "inbound", Action: "block", Protocol: "tcp", LocalPort: "22",
	}}); len(w) == 0 || !strings.Contains(w[0], "SSH") {
		t.Errorf("blocking inbound 22 should warn about SSH, got %v", w)
	}
	if w := AssessLockout(Change{Op: OpAdd, Rule: RuleSpec{
		Name: "Block all", Direction: "inbound", Action: "block", Protocol: "any",
	}}); len(w) == 0 || !strings.Contains(w[0], "ALL inbound") {
		t.Errorf("blocking all inbound should warn, got %v", w)
	}
	if w := AssessLockout(Change{Op: OpAdd, Rule: RuleSpec{
		Name: "Allow HTTPS", Direction: "inbound", Action: "allow", Protocol: "tcp", LocalPort: "443",
	}}); len(w) != 0 {
		t.Errorf("allowing 443 inbound is safe, got %v", w)
	}
	if w := AssessLockout(Change{Op: OpDelete, Rule: RuleSpec{Name: "x"}}); len(w) == 0 {
		t.Error("delete should always warn")
	}
}
