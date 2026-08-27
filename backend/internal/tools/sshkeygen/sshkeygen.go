// Package sshkeygen generates SSH key pairs with Go's standard library and
// renders them in the same OpenSSH text formats `ssh-keygen` produces. It is
// the backend "power mode" for the client-side SSH Key Pair Generator, which
// covers only unencrypted Ed25519 — this package adds RSA, ECDSA and
// passphrase-encrypted private keys. See TOOL_STRATEGY_REVIEW.md bucket 3.
package sshkeygen

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

// Options for one key-pair generation.
type Options struct {
	// Type is one of: ed25519, rsa, ecdsa.
	Type string
	// Bits applies to rsa only (2048 / 3072 / 4096). Ignored otherwise.
	Bits int
	// Curve applies to ecdsa only (256 / 384 / 521). Ignored otherwise.
	Curve int
	// Comment is appended to the public-key line and embedded in the private
	// key. Newlines are stripped.
	Comment string
	// Passphrase, when non-empty, encrypts the private key with the same
	// bcrypt-pbkdf KDF `ssh-keygen` uses.
	Passphrase string
}

// Result is the rendered key pair.
type Result struct {
	KeyType           string `json:"keyType"`
	PublicKeyLine     string `json:"publicKeyLine"`
	PrivateKeyPem     string `json:"privateKeyPem"`
	FingerprintSHA256 string `json:"fingerprintSha256"`
	Encrypted         bool   `json:"encrypted"`
}

// Generate produces a key pair per opts.
func Generate(opts Options) (Result, error) {
	comment := strings.NewReplacer("\n", " ", "\r", " ").Replace(opts.Comment)
	comment = strings.TrimSpace(comment)

	var signer crypto.Signer
	var keyType string
	var err error

	switch strings.ToLower(opts.Type) {
	case "", "ed25519":
		keyType = "ed25519"
		_, priv, e := ed25519.GenerateKey(rand.Reader)
		signer, err = priv, e
	case "rsa":
		bits := opts.Bits
		switch bits {
		case 2048, 3072, 4096:
		default:
			return Result{}, fmt.Errorf("rsa bits must be 2048, 3072 or 4096 (got %d)", bits)
		}
		keyType = fmt.Sprintf("rsa-%d", bits)
		key, e := rsa.GenerateKey(rand.Reader, bits)
		signer, err = key, e
	case "ecdsa":
		var curve elliptic.Curve
		switch opts.Curve {
		case 0, 256:
			curve = elliptic.P256()
		case 384:
			curve = elliptic.P384()
		case 521:
			curve = elliptic.P521()
		default:
			return Result{}, fmt.Errorf("ecdsa curve must be 256, 384 or 521 (got %d)", opts.Curve)
		}
		keyType = fmt.Sprintf("ecdsa-p%d", curveBits(curve))
		key, e := ecdsa.GenerateKey(curve, rand.Reader)
		signer, err = key, e
	default:
		return Result{}, fmt.Errorf("unknown key type %q (want ed25519, rsa or ecdsa)", opts.Type)
	}
	if err != nil {
		return Result{}, fmt.Errorf("key generation failed: %w", err)
	}

	pub, err := ssh.NewPublicKey(signer.Public())
	if err != nil {
		return Result{}, fmt.Errorf("could not marshal public key: %w", err)
	}
	pubLine := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub)))
	if comment != "" {
		pubLine += " " + comment
	}

	var block *pem.Block
	if opts.Passphrase != "" {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(signer, comment, []byte(opts.Passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(signer, comment)
	}
	if err != nil {
		return Result{}, fmt.Errorf("could not marshal private key: %w", err)
	}

	return Result{
		KeyType:           keyType,
		PublicKeyLine:     pubLine,
		PrivateKeyPem:     string(pem.EncodeToMemory(block)),
		FingerprintSHA256: ssh.FingerprintSHA256(pub),
		Encrypted:         opts.Passphrase != "",
	}, nil
}

func curveBits(c elliptic.Curve) int { return c.Params().BitSize }
