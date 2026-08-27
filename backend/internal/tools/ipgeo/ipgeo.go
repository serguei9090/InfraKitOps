// Package ipgeo resolves an IP or hostname to a geolocation record via the
// free ip-api.com endpoint. See NETWORK_MODULE_PLAN.md tool #11. A bundled
// MaxMind path is a later addition (needs the user's own license key).
package ipgeo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// apiURL is a var so tests can point it at a stub server.
var apiURL = "http://ip-api.com/json/"

// apiURLOverride, when non-empty, replaces apiURL (test hook).
var apiURLOverride string

func endpoint() string {
	if apiURLOverride != "" {
		return apiURLOverride
	}
	return apiURL
}

// the fields we request, in display order
var fields = []string{
	"status", "message", "continent", "country", "countryCode", "region", "regionName",
	"city", "district", "zip", "lat", "lon", "timezone", "offset", "currency",
	"isp", "org", "as", "asname", "reverse", "mobile", "proxy", "hosting", "query",
}

// Result is the tool output; shape is "text" (the formatted block is diffed).
type Result struct {
	V          int            `json:"v"`
	Query      string         `json:"query"`
	Fields     map[string]any `json:"fields"`
	Order      []string       `json:"order"`
	Text       string         `json:"text"`
	RateRemain int            `json:"rateRemaining"`
	RateReset  int            `json:"rateResetSec"`
}

// Lookup queries ip-api for `query` (IP or hostname). `client` lets the caller
// inject a proxy-aware http.Client; nil uses a default.
func Lookup(ctx context.Context, client *http.Client, query string) (Result, error) {
	query = strings.TrimSpace(query)
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}

	fieldMask := strings.Join(fields, ",")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint()+query+"?fields="+fieldMask, nil)
	if err != nil {
		return Result{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()

	rateRemain, _ := strconv.Atoi(resp.Header.Get("X-Rl"))
	rateReset, _ := strconv.Atoi(resp.Header.Get("X-Ttl"))

	if resp.StatusCode == http.StatusTooManyRequests {
		return Result{}, fmt.Errorf("ip-api rate limit reached; retry in %ds", rateReset)
	}

	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return Result{}, err
	}
	if status, _ := raw["status"].(string); status == "fail" {
		msg, _ := raw["message"].(string)
		return Result{}, fmt.Errorf("ip-api: %s", msg)
	}

	res := Result{
		V:          1,
		Query:      query,
		Fields:     raw,
		RateRemain: rateRemain,
		RateReset:  rateReset,
	}
	res.Order, res.Text = formatBlock(raw)
	return res, nil
}

func formatBlock(raw map[string]any) (order []string, text string) {
	// Present the known fields first in their canonical order, then anything else.
	seen := map[string]bool{}
	var b strings.Builder
	add := func(k string) {
		v, ok := raw[k]
		if !ok || k == "status" || k == "message" {
			return
		}
		seen[k] = true
		order = append(order, k)
		fmt.Fprintf(&b, "%-13s %v\n", k, v)
	}
	for _, k := range fields {
		add(k)
	}
	extra := make([]string, 0)
	for k := range raw {
		if !seen[k] && k != "status" && k != "message" {
			extra = append(extra, k)
		}
	}
	sort.Strings(extra)
	for _, k := range extra {
		add(k)
	}
	return order, strings.TrimRight(b.String(), "\n")
}
