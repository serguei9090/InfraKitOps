// Package tlscert manages the backend's TLS certificate for multi-user
// deployments (USER_MANAGEMENT_PLAN U6). `--tls auto` generates a long-lived
// self-signed cert on first run; the client pins its SHA-256 fingerprint the
// same way the Runbooks SSH executor pins a host key.
package tlscert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// Fingerprint returns the lowercase hex SHA-256 of a cert's DER bytes,
// formatted "sha256:aa:bb:...".
func Fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	h := hex.EncodeToString(sum[:])
	out := make([]byte, 0, len(h)+len(h)/2)
	for i := 0; i < len(h); i += 2 {
		if i > 0 {
			out = append(out, ':')
		}
		out = append(out, h[i], h[i+1])
	}
	return "sha256:" + string(out)
}

// Load returns a tls.Certificate + its fingerprint. mode is:
//   - "auto": load <dir>/server.crt|server.key, generating them if absent
//   - "<certfile>": bring-your-own; keyFile must also be set
func Load(mode, dir, keyFile string, extraHosts []string) (tls.Certificate, string, error) {
	if mode == "" || mode == "off" {
		return tls.Certificate{}, "", nil
	}
	if mode == "auto" {
		crt := filepath.Join(dir, "server.crt")
		key := filepath.Join(dir, "server.key")
		if !exists(crt) || !exists(key) {
			if err := generate(crt, key, extraHosts); err != nil {
				return tls.Certificate{}, "", fmt.Errorf("generate self-signed cert: %w", err)
			}
		}
		return loadPair(crt, key)
	}
	// BYO
	if keyFile == "" {
		return tls.Certificate{}, "", fmt.Errorf("--tls <cert> also needs --tls-key <key>")
	}
	return loadPair(mode, keyFile)
}

func loadPair(certFile, keyFile string) (tls.Certificate, string, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	return cert, Fingerprint(cert.Certificate[0]), nil
}

func generate(certFile, keyFile string, extraHosts []string) error {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "InfraKit Studio backend"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	for _, h := range extraHosts {
		if ip := net.ParseIP(h); ip != nil {
			tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
		} else if h != "" {
			tmpl.DNSNames = append(tmpl.DNSNames, h)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		return err
	}
	if err := writePEM(certFile, "CERTIFICATE", der, 0o644); err != nil {
		return err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return err
	}
	return writePEM(keyFile, "PRIVATE KEY", keyDER, 0o600)
}

func writePEM(path, typ string, der []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer f.Close()
	return pem.Encode(f, &pem.Block{Type: typ, Bytes: der})
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
