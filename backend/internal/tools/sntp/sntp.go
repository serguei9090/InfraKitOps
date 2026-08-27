// Package sntp queries one or more NTP servers and reports each server's clock
// offset and round-trip delay — the SNTP Lookup tool. See
// NETWORK_MODULE_PLAN.md tool #9.
package sntp

import (
	"sort"
	"sync"
	"time"

	"github.com/beevik/ntp"
)

// ServerResult is one row of the lookup.
type ServerResult struct {
	Server         string  `json:"server"`
	IP             string  `json:"ip,omitempty"`
	OK             bool    `json:"ok"`
	Error          string  `json:"error,omitempty"`
	ClockOffsetSec float64 `json:"clockOffsetSec"`
	RTTMillis      float64 `json:"rttMs"`
	Stratum        uint8   `json:"stratum"`
	ReferenceID    string  `json:"referenceId,omitempty"`
	// Local send / receive and the server's idea of "now", all RFC3339.
	QueriedAt  string `json:"queriedAt"`
	ServerTime string `json:"serverTime,omitempty"`
}

// Result is the full tool output.
type Result struct {
	V               int            `json:"v"`
	Servers         []ServerResult `json:"servers"`
	MedianOffsetSec float64        `json:"medianOffsetSec"`
	OKCount         int            `json:"okCount"`
}

// Options controls the query.
type Options struct {
	Servers []string
	Timeout time.Duration
}

// Query hits every server concurrently and returns the collated result.
func Query(opts Options) Result {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 4 * time.Second
	}

	rows := make([]ServerResult, len(opts.Servers))
	var wg sync.WaitGroup
	for i, server := range opts.Servers {
		wg.Add(1)
		go func(i int, server string) {
			defer wg.Done()
			rows[i] = queryOne(server, timeout)
		}(i, server)
	}
	wg.Wait()

	res := Result{V: 1, Servers: rows}
	offsets := make([]float64, 0, len(rows))
	for _, r := range rows {
		if r.OK {
			res.OKCount++
			offsets = append(offsets, r.ClockOffsetSec)
		}
	}
	res.MedianOffsetSec = median(offsets)
	return res
}

func queryOne(server string, timeout time.Duration) ServerResult {
	now := time.Now()
	row := ServerResult{Server: server, QueriedAt: now.UTC().Format(time.RFC3339Nano)}

	resp, err := ntp.QueryWithOptions(server, ntp.QueryOptions{Timeout: timeout})
	if err != nil {
		row.Error = err.Error()
		return row
	}
	if err := resp.Validate(); err != nil {
		row.Error = err.Error()
		return row
	}

	row.OK = true
	row.ClockOffsetSec = resp.ClockOffset.Seconds()
	row.RTTMillis = float64(resp.RTT) / float64(time.Millisecond)
	row.Stratum = resp.Stratum
	row.ReferenceID = referenceID(resp)
	row.ServerTime = resp.Time.UTC().Format(time.RFC3339Nano)
	return row
}

func referenceID(resp *ntp.Response) string {
	if resp.ReferenceString() != "" {
		return resp.ReferenceString()
	}
	return ""
}

func median(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	mid := len(s) / 2
	if len(s)%2 == 1 {
		return s[mid]
	}
	return (s[mid-1] + s[mid]) / 2
}
