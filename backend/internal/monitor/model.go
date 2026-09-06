// Package monitor is the server-side persistent-monitoring subsystem
// (MONITORS_MODULE_PLAN.md, background-runs Tier 2). A Monitor is a small check
// — ping a host, open a TCP port, GET a URL, look at a cert — that the backend
// runs on a fixed interval forever, keeping a capped history and flipping an
// up/down status that the frontend and an optional webhook react to.
//
// Unlike internal/runstream (finite jobs, replay the whole log), a monitor
// never ends and keeps only a rolling window of samples.
package monitor

import "strings"

// Status values for a Monitor.
const (
	StatusUp      = "up"
	StatusDown    = "down"
	StatusUnknown = "unknown" // enabled but no probe has landed yet
	StatusPaused  = "paused"
)

// Kind values — one Probe implementation each.
const (
	KindICMP   = "icmp"
	KindTCP    = "tcp"
	KindHTTP   = "http"
	KindDNS    = "dns"
	KindTLS    = "tls-cert"
	KindDomain = "domain"
)

// Monitor is one configured check.
type Monitor struct {
	ID            string `json:"id"`
	Owner         string `json:"owner,omitempty"`
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	Target        string `json:"target"` // host / host:port / url — kind-specific
	IntervalSec   int    `json:"intervalSec"`
	TimeoutSec    int    `json:"timeoutSec"`
	FailThreshold int    `json:"failThreshold"` // consecutive fails before "down"
	Enabled       bool   `json:"enabled"`
	// Config is kind-specific JSON: http {expectStatus, expectBody},
	// dns {expectAddr}, tls-cert {warnDays}.
	Config map[string]any `json:"config,omitempty"`

	// Tags is a comma-separated list for grouping / filtering (M3).
	Tags string `json:"tags,omitempty"`
	// Channel overrides Settings.DefaultChannel for this monitor's alerts
	// ("" = use the default). (M3)
	Channel string `json:"channel,omitempty"`
	// AlertAfterSec / RenotifyEverySec override Settings when > 0. (M3)
	AlertAfterSec    int `json:"alertAfterSec,omitempty"`
	RenotifyEverySec int `json:"renotifyEverySec,omitempty"`
	// MutedUntil: unix ms; while now < MutedUntil the monitor still probes +
	// records but sends no alerts. (M3)
	MutedUntil int64 `json:"mutedUntil,omitempty"`

	Status        string `json:"status"`
	LastCheckedAt int64  `json:"lastCheckedAt"`
	LastChangeAt  int64  `json:"lastChangeAt"`
	CreatedAt     int64  `json:"createdAt"`
}

// Sample is one probe result.
type Sample struct {
	T      int64   `json:"t"`
	OK     bool    `json:"ok"`
	Value  float64 `json:"value"` // ms for icmp/tcp/http, days for tls-cert, 0/1 for dns
	Detail string  `json:"detail,omitempty"`
}

// AlertEvent is emitted on a status transition.
type AlertEvent struct {
	Monitor Monitor `json:"monitor"`
	Event   string  `json:"event"` // "down" | "recovered"
	At      int64   `json:"at"`
	Detail  string  `json:"detail,omitempty"`
}

// defaults applied on create when a field is zero.
const (
	defaultIntervalSec   = 60
	defaultTimeoutSec    = 10
	defaultFailThreshold = 3
	minIntervalSec       = 5
	maxSamplesPerMonitor = 5000
)

// kindDefaultInterval is the sensible check cadence per kind when the caller
// didn't pick one — cert / domain expiry move slowly and whois is rate-limited.
func kindDefaultInterval(kind string) int {
	switch kind {
	case KindTLS:
		return 3600 // hourly
	case KindDomain:
		return 43200 // twice a day
	default:
		return defaultIntervalSec // 60s
	}
}

// normalize clamps a Monitor's numeric fields to sane values.
func (m *Monitor) normalize() {
	if m.IntervalSec <= 0 {
		m.IntervalSec = kindDefaultInterval(m.Kind)
	}
	if m.IntervalSec < minIntervalSec {
		m.IntervalSec = minIntervalSec
	}
	if m.TimeoutSec <= 0 {
		m.TimeoutSec = defaultTimeoutSec
	}
	if m.TimeoutSec > m.IntervalSec {
		m.TimeoutSec = m.IntervalSec
	}
	if m.FailThreshold <= 0 {
		m.FailThreshold = defaultFailThreshold
	}
}

// cfgInt reads an int from Config (JSON numbers decode as float64).
func (m *Monitor) cfgInt(key string, def int) int {
	if v, ok := m.Config[key]; ok {
		if f, ok := v.(float64); ok {
			return int(f)
		}
	}
	return def
}

func (m *Monitor) cfgString(key string) string {
	if v, ok := m.Config[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func (m *Monitor) cfgBool(key string) bool { return m.cfgBoolDefault(key, false) }

func (m *Monitor) cfgBoolDefault(key string, def bool) bool {
	if v, ok := m.Config[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return def
}

func (m *Monitor) cfgFloat(key string, def float64) float64 {
	if v, ok := m.Config[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return def
}

// TagList splits Tags on commas, trimmed, empties dropped.
func (m *Monitor) TagList() []string {
	var out []string
	for _, t := range strings.Split(m.Tags, ",") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// cfgStrings reads a []string from Config — accepts a JSON array or a single
// string or a comma/space/newline-separated string.
func (m *Monitor) cfgStrings(key string) []string {
	v, ok := m.Config[key]
	if !ok {
		return nil
	}
	switch t := v.(type) {
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if s, ok := e.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	case string:
		var out []string
		for _, s := range strings.FieldsFunc(t, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' }) {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
