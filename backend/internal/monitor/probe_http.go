package monitor

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/executor"
)

func init() { register(httpProbe{}) }

// httpProbe requests target and checks status / latency / one content assertion.
// `value` = response time in ms. config:
//
//	method (GET), headers {k:v}, expectStatus ("200-399" | "200,204" | list),
//	maxLatencyMs (0 = off), followRedirects (default true),
//	assertBodyContains, assertBodyAbsent, assertJsonPath + assertJsonEquals.
type httpProbe struct{}

func (httpProbe) Kind() string { return KindHTTP }

const maxHTTPBody = 512 << 10 // 512 KiB is plenty for a health check

func (httpProbe) Probe(ctx context.Context, m Monitor) Sample {
	target := strings.TrimSpace(m.Target)
	if !strings.Contains(target, "://") {
		target = "https://" + target
	}
	method := strings.ToUpper(nz(m.cfgString("method"), "GET"))

	req, err := http.NewRequestWithContext(ctx, method, target, nil)
	if err != nil {
		return Sample{OK: false, Detail: errDetail("bad request", err)}
	}
	if hs, ok := m.Config["headers"].(map[string]any); ok {
		for k, v := range hs {
			if s, ok := v.(string); ok {
				req.Header.Set(k, s)
			}
		}
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "InfraKit-Monitor/1")
	}

	client := &http.Client{Timeout: time.Duration(m.TimeoutSec) * time.Second}
	if !m.cfgBoolDefault("followRedirects", true) {
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return Sample{OK: false, Value: ms(time.Since(start)), Detail: errDetail("request", err)}
	}
	defer resp.Body.Close()
	elapsed := ms(time.Since(start))
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxHTTPBody))

	if !statusAllowed(resp.StatusCode, m.cfgString("expectStatus")) {
		return Sample{OK: false, Value: elapsed, Detail: fmt.Sprintf("status %d", resp.StatusCode)}
	}
	if lim := m.cfgFloat("maxLatencyMs", 0); lim > 0 && elapsed > lim {
		return Sample{OK: false, Value: elapsed, Detail: fmt.Sprintf("slow: %.0f ms > %.0f", elapsed, lim)}
	}
	if sub := m.cfgString("assertBodyContains"); sub != "" && !strings.Contains(string(body), sub) {
		return Sample{OK: false, Value: elapsed, Detail: "body missing: " + sub}
	}
	if sub := m.cfgString("assertBodyAbsent"); sub != "" && strings.Contains(string(body), sub) {
		return Sample{OK: false, Value: elapsed, Detail: "body contains: " + sub}
	}
	if path := m.cfgString("assertJsonPath"); path != "" {
		got, found := executor.EvalDotPath(string(body), path)
		want := m.cfgString("assertJsonEquals")
		if !found {
			return Sample{OK: false, Value: elapsed, Detail: "json path not found: " + path}
		}
		if want != "" && got != want {
			return Sample{OK: false, Value: elapsed, Detail: fmt.Sprintf("%s = %q, want %q", path, got, want)}
		}
	}
	return Sample{OK: true, Value: elapsed, Detail: fmt.Sprintf("%d in %.0f ms", resp.StatusCode, elapsed)}
}

// statusAllowed matches code against a spec: "" → 200–399; "200,204"; "200-299";
// or a mix ("200,300-399").
func statusAllowed(code int, spec string) bool {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return code >= 200 && code < 400
	}
	for _, part := range strings.FieldsFunc(spec, func(r rune) bool { return r == ',' || r == ' ' }) {
		if lo, hi, ok := strings.Cut(part, "-"); ok {
			a, e1 := strconv.Atoi(strings.TrimSpace(lo))
			b, e2 := strconv.Atoi(strings.TrimSpace(hi))
			if e1 == nil && e2 == nil && code >= a && code <= b {
				return true
			}
			continue
		}
		if n, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && n == code {
			return true
		}
	}
	return false
}
