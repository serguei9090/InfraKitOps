package sshkeygen

import (
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestGenerateAllTypes(t *testing.T) {
	cases := []struct {
		opts   Options
		prefix string
	}{
		{Options{Type: "ed25519", Comment: "me@host"}, "ssh-ed25519 "},
		{Options{Type: "rsa", Bits: 2048}, "ssh-rsa "},
		{Options{Type: "rsa", Bits: 4096}, "ssh-rsa "},
		{Options{Type: "ecdsa", Curve: 256}, "ecdsa-sha2-nistp256 "},
		{Options{Type: "ecdsa", Curve: 521}, "ecdsa-sha2-nistp521 "},
	}
	for _, c := range cases {
		res, err := Generate(c.opts)
		if err != nil {
			t.Fatalf("%+v: %v", c.opts, err)
		}
		if !strings.HasPrefix(res.PublicKeyLine, c.prefix) {
			t.Errorf("%+v: public line %q missing prefix %q", c.opts, res.PublicKeyLine, c.prefix)
		}
		if !strings.Contains(res.PrivateKeyPem, "OPENSSH PRIVATE KEY") {
			t.Errorf("%+v: private key is not OpenSSH format", c.opts)
		}
		// The public key must parse and match the private key.
		signer, err := ssh.ParsePrivateKey([]byte(res.PrivateKeyPem))
		if err != nil {
			t.Fatalf("%+v: private key does not parse: %v", c.opts, err)
		}
		gotPub := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
		if wantPub := strings.Fields(res.PublicKeyLine)[0] + " " + strings.Fields(res.PublicKeyLine)[1]; gotPub != wantPub {
			t.Errorf("%+v: pub/priv mismatch\n got %q\nwant %q", c.opts, gotPub, wantPub)
		}
		if !strings.HasPrefix(res.FingerprintSHA256, "SHA256:") {
			t.Errorf("%+v: bad fingerprint %q", c.opts, res.FingerprintSHA256)
		}
	}
}

func TestGeneratePassphrase(t *testing.T) {
	res, err := Generate(Options{Type: "ed25519", Passphrase: "hunter2"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Encrypted {
		t.Fatal("expected Encrypted=true")
	}
	if _, err := ssh.ParsePrivateKey([]byte(res.PrivateKeyPem)); err == nil {
		t.Fatal("expected parse without passphrase to fail")
	}
	if _, err := ssh.ParsePrivateKeyWithPassphrase([]byte(res.PrivateKeyPem), []byte("hunter2")); err != nil {
		t.Fatalf("parse with passphrase failed: %v", err)
	}
}

func TestGenerateRejectsBadParams(t *testing.T) {
	if _, err := Generate(Options{Type: "rsa", Bits: 1024}); err == nil {
		t.Error("expected rsa-1024 to be rejected")
	}
	if _, err := Generate(Options{Type: "ecdsa", Curve: 999}); err == nil {
		t.Error("expected ecdsa curve 999 to be rejected")
	}
	if _, err := Generate(Options{Type: "dsa"}); err == nil {
		t.Error("expected unknown type to be rejected")
	}
}
