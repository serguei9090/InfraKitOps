// Package envelope defines the common result envelope every network tool
// returns. It is stored verbatim by the history layer (see NETWORK_MODULE_PLAN.md
// §2.3) so that run-over-run diffing works without per-tool storage code.
package envelope

// ResultShape selects which diff strategy the history/compare UI applies to a
// run's Result blob.
type ResultShape string

const (
	// ShapeScalarSeries: a time series of numeric samples (ping RTT, DNS
	// resolve time). Diffed as delta-of-summary-stats + a latency sparkline.
	ShapeScalarSeries ResultShape = "scalar_series"
	// ShapeSet: an unordered set of keyed items (open ports, discovered
	// hosts, traceroute hops, DNS records). Diffed as added/removed/unchanged.
	ShapeSet ResultShape = "set"
	// ShapeTable: keyed rows with mutable columns (scan host+port rows, ARP
	// tables). Diffed per-row as added/removed/modified.
	ShapeTable ResultShape = "table"
	// ShapeText: an opaque text blob (whois, dig +trace). Diffed as a
	// normalized unified diff.
	ShapeText ResultShape = "text"
)

// Status is the terminal state of a run.
type Status string

const (
	StatusOK      Status = "ok"
	StatusPartial Status = "partial"
	StatusError   Status = "error"
	StatusTimeout Status = "timeout"
)

// Envelope wraps a single tool run. Field names match the TS `RunEnvelope`
// interface in app/src/core/network/history/.
type Envelope struct {
	Tool        string         `json:"tool"`
	Target      string         `json:"target"`
	StartedAt   int64          `json:"startedAt"`            // unix ms UTC
	FinishedAt  int64          `json:"finishedAt,omitempty"` // unix ms UTC
	Status      Status         `json:"status"`
	Params      map[string]any `json:"params"` // canonicalized (sorted keys) by the caller
	ResultShape ResultShape    `json:"resultShape"`
	Result      any            `json:"result"`            // tool-specific, self-versioned { v: N, ... }
	Summary     map[string]any `json:"summary,omitempty"` // headline metrics for the history list row
}
