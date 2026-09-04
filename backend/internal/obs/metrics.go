package obs

import (
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// Dependency-free Prometheus text exposition. Just enough to answer "is it
// up, how much traffic, how slow, how many errors" — not a full client lib.

var (
	inFlight    atomic.Int64
	startedUnix = time.Now().Unix()
	buildVer    = "dev"

	reqMu     sync.Mutex
	reqTotal  = map[reqKey]uint64{}             // {method,code} → count
	durBucket = map[string][durBucketN]uint64{} // method → bucketed counts
	durSum    = map[string]float64{}            // method → total seconds
	durCount  = map[string]uint64{}             // method → observations
)

type reqKey struct {
	method string
	code   int
}

// Fixed histogram buckets (seconds). Last is +Inf.
var durBounds = [...]float64{0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

const durBucketN = len(durBounds) + 1

// SetBuildVersion stamps infrakit_build_info (call once at startup).
func SetBuildVersion(v string) {
	if v != "" {
		buildVer = v
	}
}

func recordRequest(method string, code int, d time.Duration) {
	sec := d.Seconds()
	reqMu.Lock()
	reqTotal[reqKey{method, code}]++
	b := durBucket[method]
	for i, hi := range durBounds {
		if sec <= hi {
			b[i]++
		}
	}
	b[durBucketN-1]++ // +Inf
	durBucket[method] = b
	durSum[method] += sec
	durCount[method]++
	reqMu.Unlock()
}

// MetricsHandler renders the exposition format.
func MetricsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)

		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

		fmt.Fprintf(w, "# HELP infrakit_build_info Build metadata.\n# TYPE infrakit_build_info gauge\n")
		fmt.Fprintf(w, "infrakit_build_info{version=%q} 1\n", buildVer)

		fmt.Fprintf(w, "# HELP infrakit_start_time_seconds Process start, unix seconds.\n# TYPE infrakit_start_time_seconds gauge\n")
		fmt.Fprintf(w, "infrakit_start_time_seconds %d\n", startedUnix)

		fmt.Fprintf(w, "# HELP infrakit_http_in_flight In-flight HTTP requests.\n# TYPE infrakit_http_in_flight gauge\n")
		fmt.Fprintf(w, "infrakit_http_in_flight %d\n", inFlight.Load())

		reqMu.Lock()
		fmt.Fprintf(w, "# HELP infrakit_http_requests_total HTTP requests by method + status.\n# TYPE infrakit_http_requests_total counter\n")
		for k, v := range reqTotal {
			fmt.Fprintf(w, "infrakit_http_requests_total{method=%q,code=%q} %d\n", k.method, strconv.Itoa(k.code), v)
		}
		fmt.Fprintf(w, "# HELP infrakit_http_request_duration_seconds Request duration.\n# TYPE infrakit_http_request_duration_seconds histogram\n")
		for method, b := range durBucket {
			for i := 0; i < len(durBounds); i++ {
				fmt.Fprintf(w, "infrakit_http_request_duration_seconds_bucket{method=%q,le=%q} %d\n",
					method, strconv.FormatFloat(durBounds[i], 'g', -1, 64), b[i])
			}
			fmt.Fprintf(w, "infrakit_http_request_duration_seconds_bucket{method=%q,le=\"+Inf\"} %d\n", method, b[durBucketN-1])
			fmt.Fprintf(w, "infrakit_http_request_duration_seconds_sum{method=%q} %g\n", method, durSum[method])
			fmt.Fprintf(w, "infrakit_http_request_duration_seconds_count{method=%q} %d\n", method, durCount[method])
		}
		reqMu.Unlock()

		fmt.Fprintf(w, "# HELP infrakit_goroutines Current goroutines.\n# TYPE infrakit_goroutines gauge\n")
		fmt.Fprintf(w, "infrakit_goroutines %d\n", runtime.NumGoroutine())
		fmt.Fprintf(w, "# HELP infrakit_mem_alloc_bytes Allocated heap bytes.\n# TYPE infrakit_mem_alloc_bytes gauge\n")
		fmt.Fprintf(w, "infrakit_mem_alloc_bytes %d\n", ms.Alloc)
	}
}
