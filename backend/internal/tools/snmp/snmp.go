// Package snmp performs SNMP Get and Walk against a target — the SNMP tool.
// v1 / v2c / v3 (USM auth+priv). See NETWORK_MODULE_PLAN.md tool #16.
package snmp

import (
	"context"
	"fmt"
	"strings"
	"time"

	g "github.com/gosnmp/gosnmp"
)

// Row is one OID → value pair.
type Row struct {
	OID   string `json:"oid"`
	Type  string `json:"type"`
	Value string `json:"value"`
}

// Result — shape "set", keyed by OID so walk output diffs cleanly.
type Result struct {
	V     int              `json:"v"`
	Mode  string           `json:"mode"`
	Rows  []Row            `json:"rows"`
	Items []map[string]any `json:"items"`
}

// Options configures the request.
type Options struct {
	Host      string
	Port      uint16
	Version   string // "1" | "2c" | "3"
	Community string
	Mode      string // "get" | "walk"
	OIDs      []string
	Timeout   time.Duration
	Retries   int

	// v3
	SecLevel  string // "noAuthNoPriv" | "authNoPriv" | "authPriv"
	Username  string
	AuthProto string // MD5 SHA SHA224 SHA256 SHA384 SHA512
	AuthKey   string
	PrivProto string // DES AES AES192 AES256
	PrivKey   string
}

// Query runs the Get or Walk.
func Query(ctx context.Context, opts Options) (Result, error) {
	port := opts.Port
	if port == 0 {
		port = 161
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	retries := opts.Retries
	if retries <= 0 {
		retries = 1
	}

	client := &g.GoSNMP{
		Target:  opts.Host,
		Port:    port,
		Timeout: timeout,
		Retries: retries,
		Context: ctx,
	}

	switch opts.Version {
	case "1":
		client.Version = g.Version1
		client.Community = opts.Community
	case "3":
		client.Version = g.Version3
		client.SecurityModel = g.UserSecurityModel
		client.MsgFlags = secLevel(opts.SecLevel)
		usm := &g.UsmSecurityParameters{UserName: opts.Username}
		if p, ok := authProto(opts.AuthProto); ok {
			usm.AuthenticationProtocol = p
			usm.AuthenticationPassphrase = opts.AuthKey
		}
		if p, ok := privProto(opts.PrivProto); ok {
			usm.PrivacyProtocol = p
			usm.PrivacyPassphrase = opts.PrivKey
		}
		client.SecurityParameters = usm
	default: // "2c"
		client.Version = g.Version2c
		client.Community = opts.Community
	}

	if err := client.Connect(); err != nil {
		return Result{}, fmt.Errorf("connect: %w", err)
	}
	defer client.Conn.Close()

	res := Result{V: 1, Mode: opts.Mode}

	if opts.Mode == "walk" {
		root := firstOID(opts.OIDs)
		err := client.BulkWalk(root, func(pdu g.SnmpPDU) error {
			res.Rows = append(res.Rows, toRow(pdu))
			return nil
		})
		if err != nil {
			// v1 has no GETBULK — fall back
			if client.Version == g.Version1 {
				err = client.Walk(root, func(pdu g.SnmpPDU) error {
					res.Rows = append(res.Rows, toRow(pdu))
					return nil
				})
			}
			if err != nil {
				return res, err
			}
		}
	} else {
		packet, err := client.Get(opts.OIDs)
		if err != nil {
			return res, err
		}
		for _, pdu := range packet.Variables {
			res.Rows = append(res.Rows, toRow(pdu))
		}
	}

	for _, r := range res.Rows {
		res.Items = append(res.Items, map[string]any{
			"key":    r.OID,
			"label":  r.OID,
			"detail": fmt.Sprintf("%s  (%s)", r.Value, r.Type),
		})
	}
	return res, nil
}

func toRow(pdu g.SnmpPDU) Row {
	r := Row{OID: strings.TrimPrefix(pdu.Name, "."), Type: pdu.Type.String()}
	switch pdu.Type {
	case g.OctetString:
		if b, ok := pdu.Value.([]byte); ok {
			r.Value = string(b)
		} else {
			r.Value = fmt.Sprintf("%v", pdu.Value)
		}
	case g.ObjectIdentifier:
		r.Value = fmt.Sprintf("%v", pdu.Value)
	case g.NoSuchObject, g.NoSuchInstance, g.EndOfMibView:
		r.Value = pdu.Type.String()
	default:
		r.Value = fmt.Sprintf("%v", pdu.Value)
	}
	return r
}

func secLevel(s string) g.SnmpV3MsgFlags {
	switch strings.ToLower(s) {
	case "authnopriv":
		return g.AuthNoPriv
	case "authpriv":
		return g.AuthPriv
	default:
		return g.NoAuthNoPriv
	}
}

func authProto(s string) (g.SnmpV3AuthProtocol, bool) {
	switch strings.ToUpper(s) {
	case "MD5":
		return g.MD5, true
	case "SHA":
		return g.SHA, true
	case "SHA224":
		return g.SHA224, true
	case "SHA256":
		return g.SHA256, true
	case "SHA384":
		return g.SHA384, true
	case "SHA512":
		return g.SHA512, true
	}
	return g.NoAuth, false
}

func privProto(s string) (g.SnmpV3PrivProtocol, bool) {
	switch strings.ToUpper(s) {
	case "DES":
		return g.DES, true
	case "AES":
		return g.AES, true
	case "AES192":
		return g.AES192, true
	case "AES256":
		return g.AES256, true
	}
	return g.NoPriv, false
}

func firstOID(oids []string) string {
	if len(oids) > 0 {
		return oids[0]
	}
	return "1.3.6.1.2.1.1" // system subtree
}
