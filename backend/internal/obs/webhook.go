package obs

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// A dep-free crash sink: when an error webhook URL is configured, the
// Recoverer (and any caller of Report) POSTs a small JSON blob to it —
// fire-and-forget, rate-limited, best-effort. Point it at a Slack incoming
// webhook or any collector. Off unless SetErrorWebhook is called.

var (
	webhookURL  atomic.Pointer[string]
	lastPostUx  atomic.Int64 // unix seconds — crude ≤1/s rate limit
	webhookHTTP = &http.Client{Timeout: 3 * time.Second}
)

// SetErrorWebhook enables crash reporting to url ("" disables).
func SetErrorWebhook(url string) {
	if url == "" {
		webhookURL.Store(nil)
		return
	}
	webhookURL.Store(&url)
	slog.Info("error webhook enabled")
}

// Report sends an arbitrary error to the webhook (for non-panic paths).
func Report(level, msg, reqID, errStr string) {
	post(map[string]any{
		"ts": time.Now().UTC().Format(time.RFC3339), "level": level,
		"msg": msg, "req_id": reqID, "err": truncate(errStr, 2000), "version": buildVer,
	})
}

func reportWebhook(level, msg string, r *http.Request, errVal any) {
	body := map[string]any{
		"ts": time.Now().UTC().Format(time.RFC3339), "level": level, "msg": msg,
		"err": truncate(toStr(errVal), 2000), "version": buildVer,
	}
	if r != nil {
		body["method"] = r.Method
		body["path"] = r.URL.Path
		body["req_id"] = chimw.GetReqID(r.Context())
	}
	post(body)
}

func post(body map[string]any) {
	up := webhookURL.Load()
	if up == nil {
		return
	}
	now := time.Now().Unix()
	if lastPostUx.Swap(now) == now {
		return // already sent one this second
	}
	buf, _ := json.Marshal(body)
	go func() {
		req, err := http.NewRequest(http.MethodPost, *up, bytes.NewReader(buf))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := webhookHTTP.Do(req)
		if err != nil {
			slog.Warn("error webhook post failed", "err", err)
			return
		}
		_ = resp.Body.Close()
	}()
}

func toStr(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case error:
		return t.Error()
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
