// Package dnslookup resolves a name for one or more record types against a
// chosen resolver. See NETWORK_MODULE_PLAN.md tool #7.
package dnslookup

import (
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/miekg/dns"
)

// SupportedTypes is the record-type menu the UI offers.
var SupportedTypes = []string{"A", "AAAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT", "CAA"}

// Record is one answer row.
type Record struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	TTL   uint32 `json:"ttl"`
	Value string `json:"value"`
}

// Result — shape "set", keyed by "TYPE VALUE" so record churn diffs cleanly.
type Result struct {
	V        int      `json:"v"`
	Name     string   `json:"name"`
	Resolver string   `json:"resolver"`
	Protocol string   `json:"protocol"`
	Records  []Record `json:"records"`
	Errors   []string `json:"errors,omitempty"`
}

// Options controls the query.
type Options struct {
	Name      string
	Types     []string
	Resolver  string // host or host:port; ":53" appended if no port
	TCP       bool
	Recursion bool
	Timeout   time.Duration
}

// Query performs one Exchange per requested type and collates the answers.
func Query(opts Options) (Result, error) {
	name := strings.TrimSpace(opts.Name)
	if name == "" {
		return Result{}, fmt.Errorf("a name is required")
	}
	resolver := ensurePort(strings.TrimSpace(opts.Resolver))
	if resolver == "" {
		resolver = "1.1.1.1:53"
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 4 * time.Second
	}
	types := opts.Types
	if len(types) == 0 {
		types = []string{"A"}
	}

	client := &dns.Client{Timeout: timeout}
	proto := "UDP"
	if opts.TCP {
		client.Net = "tcp"
		proto = "TCP"
	}

	res := Result{V: 1, Name: name, Resolver: resolver, Protocol: proto}

	for _, t := range types {
		qtype, ok := dns.StringToType[strings.ToUpper(t)]
		if !ok {
			res.Errors = append(res.Errors, fmt.Sprintf("unknown record type %q", t))
			continue
		}
		m := new(dns.Msg)
		q := dns.Fqdn(name)
		if qtype == dns.TypePTR && net.ParseIP(name) != nil {
			if rev, err := dns.ReverseAddr(name); err == nil {
				q = rev
			}
		}
		m.SetQuestion(q, qtype)
		m.RecursionDesired = opts.Recursion

		resp, _, err := client.Exchange(m, resolver)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", t, err))
			continue
		}
		if resp.Rcode != dns.RcodeSuccess {
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %s", t, dns.RcodeToString[resp.Rcode]))
			continue
		}
		for _, rr := range resp.Answer {
			res.Records = append(res.Records, toRecord(rr))
		}
	}

	sort.Slice(res.Records, func(i, j int) bool {
		if res.Records[i].Type != res.Records[j].Type {
			return res.Records[i].Type < res.Records[j].Type
		}
		return res.Records[i].Value < res.Records[j].Value
	})
	return res, nil
}

func toRecord(rr dns.RR) Record {
	h := rr.Header()
	full := rr.String()
	// The value is everything after the header's tab-separated preamble.
	parts := strings.SplitN(full, "\t", 5)
	value := full
	if len(parts) == 5 {
		value = parts[4]
	}
	return Record{
		Name:  strings.TrimSuffix(h.Name, "."),
		Type:  dns.TypeToString[h.Rrtype],
		TTL:   h.Ttl,
		Value: strings.TrimSpace(value),
	}
}

func ensurePort(s string) string {
	if s == "" {
		return ""
	}
	if _, _, err := net.SplitHostPort(s); err == nil {
		return s
	}
	return net.JoinHostPort(s, "53")
}
