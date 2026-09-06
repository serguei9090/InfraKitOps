// Package monitor is the server-side persistent-monitoring subsystem
// (MONITORS_MODULE_PLAN.md, background-runs Tier 2). A Monitor is a small check
// — ping a host, open a TCP port, GET a URL, look at a cert — that the backend
// runs on a fixed interval forever, keeping a capped history and flipping an
// up/down status that the frontend and an optional webhook react to.
//
// Unlike internal/runstream (finite jobs, replay the whole log), a monitor
// never ends and keeps only a rolling window of samples.
package monitor

// Status values for a Monitor.
const (
	StatusUp      = "up"
	StatusDown    = "down"
	StatusUnknown = "unknown" // enabled but no probe has landed yet
	StatusPaused  = "paused"
)

// Kind values — one Probe implementation each.
const (
	KindICMP = "icmp"
	KindTCP  = "tcp"
	KindHTTP = "http"
	KindDNS  = "dns"
	KindTLS  = "tls-cert"
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

// normalize clamps a Monitor's numeric fields to sane values.
func (m *Monitor) normalize() {
	if m.IntervalSec <= 0 {
		m.IntervalSec = defaultIntervalSec
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
