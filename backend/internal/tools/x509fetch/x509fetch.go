// Package x509fetch connects to a TLS server and returns the certificate
// chain it presents, plus whether that chain verifies against the system
// trust store. It is the backend "power mode" for the client-side X.509
// Certificate Inspector, which can only inspect a pasted PEM. See
// TOOL_STRATEGY_REVIEW.md bucket 4.
package x509fetch

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net"
	"strings"
	"time"
)

// Result is the fetched chain plus connection facts.
type Result struct {
	Host        string `json:"host"`
	PEM         string `json:"pem"`
	CertCount   int    `json:"certCount"`
	Trusted     bool   `json:"trusted"`
	VerifyError string `json:"verifyError,omitempty"`
	TLSVersion  string `json:"tlsVersion"`
	CipherSuite string `json:"cipherSuite"`
	ServerName  string `json:"serverName"`
}

// Fetch dials host (host or host:port; :443 assumed) and returns its chain.
func Fetch(ctx context.Context, host string) (Result, error) {
	host = strings.TrimSpace(host)
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimSuffix(host, "/")
	if host == "" {
		return Result{}, fmt.Errorf("a hostname is required")
	}
	hostPort := host
	serverName := host
	if _, _, err := net.SplitHostPort(host); err != nil {
		hostPort = net.JoinHostPort(host, "443")
	} else {
		serverName, _, _ = net.SplitHostPort(host)
	}

	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	dialer := &tls.Dialer{
		NetDialer: &net.Dialer{Timeout: 8 * time.Second},
		Config:    &tls.Config{InsecureSkipVerify: true, ServerName: serverName}, //nolint:gosec // we report trust separately
	}
	conn, err := dialer.DialContext(dialCtx, "tcp", hostPort)
	if err != nil {
		return Result{}, fmt.Errorf("could not connect to %s: %w", hostPort, err)
	}
	defer conn.Close()

	state := conn.(*tls.Conn).ConnectionState()
	chain := state.PeerCertificates
	if len(chain) == 0 {
		return Result{}, fmt.Errorf("%s presented no certificates", hostPort)
	}

	var b strings.Builder
	for _, c := range chain {
		_ = pem.Encode(&b, &pem.Block{Type: "CERTIFICATE", Bytes: c.Raw})
	}

	res := Result{
		Host:        hostPort,
		PEM:         b.String(),
		CertCount:   len(chain),
		TLSVersion:  tlsVersionName(state.Version),
		CipherSuite: tls.CipherSuiteName(state.CipherSuite),
		ServerName:  serverName,
	}

	// Verify the presented chain against the system roots.
	intermediates := x509.NewCertPool()
	for _, c := range chain[1:] {
		intermediates.AddCert(c)
	}
	if _, verr := chain[0].Verify(x509.VerifyOptions{
		DNSName:       serverName,
		Intermediates: intermediates,
	}); verr != nil {
		res.VerifyError = verr.Error()
	} else {
		res.Trusted = true
	}
	return res, nil
}

func tlsVersionName(v uint16) string {
	switch v {
	case tls.VersionTLS10:
		return "TLS 1.0"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS13:
		return "TLS 1.3"
	default:
		return fmt.Sprintf("0x%04x", v)
	}
}
