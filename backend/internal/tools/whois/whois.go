// Package whois queries a WHOIS server for a domain or IP and returns the raw
// response plus a best-effort structured parse. See NETWORK_MODULE_PLAN.md
// tool #10.
package whois

import (
	"strings"
	"time"

	whoisclient "github.com/likexian/whois"
	whoisparser "github.com/likexian/whois-parser"
)

// Parsed is the subset of structured fields the UI shows. Any field may be empty
// when the registry's format isn't recognized.
type Parsed struct {
	DomainName     string   `json:"domainName,omitempty"`
	Registrar      string   `json:"registrar,omitempty"`
	CreatedDate    string   `json:"createdDate,omitempty"`
	UpdatedDate    string   `json:"updatedDate,omitempty"`
	ExpirationDate string   `json:"expirationDate,omitempty"`
	NameServers    []string `json:"nameServers,omitempty"`
	Statuses       []string `json:"statuses,omitempty"`
	DNSSEC         string   `json:"dnssec,omitempty"`
	RegistrantOrg  string   `json:"registrantOrg,omitempty"`
	RegistrantCC   string   `json:"registrantCountry,omitempty"`
}

// Result is the tool output. Shape is "text" (the raw response is what gets diffed).
type Result struct {
	V      int    `json:"v"`
	Query  string `json:"query"`
	Server string `json:"server,omitempty"`
	Text   string `json:"text"`
	Parsed Parsed `json:"parsed"`
	// ParseError is set when the structured parse failed but raw text is present.
	ParseError string `json:"parseError,omitempty"`
}

// Query runs the lookup. timeout <= 0 uses a 10s default.
func Query(query string, timeout time.Duration) (Result, error) {
	query = strings.TrimSpace(query)
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	client := whoisclient.NewClient()
	client.SetTimeout(timeout)

	raw, err := client.Whois(query)
	if err != nil {
		return Result{}, err
	}

	res := Result{V: 1, Query: query, Text: raw}
	parsed, perr := whoisparser.Parse(raw)
	if perr != nil {
		res.ParseError = perr.Error()
		return res, nil
	}
	res.Parsed = toParsed(parsed)
	return res, nil
}

func toParsed(p whoisparser.WhoisInfo) Parsed {
	out := Parsed{}
	if p.Domain != nil {
		out.DomainName = p.Domain.Domain
		out.CreatedDate = p.Domain.CreatedDate
		out.UpdatedDate = p.Domain.UpdatedDate
		out.ExpirationDate = p.Domain.ExpirationDate
		out.NameServers = p.Domain.NameServers
		out.Statuses = p.Domain.Status
		if p.Domain.DNSSec {
			out.DNSSEC = "signed"
		} else {
			out.DNSSEC = "unsigned"
		}
	}
	if p.Registrar != nil {
		out.Registrar = p.Registrar.Name
	}
	if p.Registrant != nil {
		out.RegistrantOrg = p.Registrant.Organization
		out.RegistrantCC = p.Registrant.Country
	}
	return out
}
