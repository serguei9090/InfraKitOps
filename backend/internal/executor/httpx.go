package executor

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// httpExecutor performs one HTTP request. The URL / headers / body already
// have their {{VAR}} tokens substituted by the run engine; auth credentials
// are resolved from the Vault. The response status + headers + body become
// the step "output" (stdout), so a later step can read `{{steps.N.stdout}}`.
type httpExecutor struct{}

// HTTPResult carries the structured response for assertions.
type HTTPResult struct {
	Status int
	Body   string
}

func (httpExecutor) Run(ctx context.Context, step Step, stdout, stderr io.Writer) Result {
	r := step.HTTP
	if r == nil || r.URL == "" {
		return Result{ExitCode: -1, Err: "http step is missing a URL"}
	}
	method := strings.ToUpper(r.Method)
	if method == "" {
		method = "GET"
	}

	var body io.Reader
	if r.Body != "" {
		body = strings.NewReader(r.Body)
	}
	req, err := http.NewRequestWithContext(ctx, method, r.URL, body)
	if err != nil {
		return Result{ExitCode: -1, Err: err.Error()}
	}
	for k, v := range r.Headers {
		req.Header.Set(k, v)
	}
	// auth was folded into r.Headers by the engine (Authorization: Bearer/Basic)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return Result{ExitCode: -1, Stderr: err.Error(), Err: err.Error()}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))

	summary := fmt.Sprintf("%s %s\n%s\n\n%s", method, r.URL, resp.Status, string(raw))
	fmt.Fprint(stdout, summary)

	ok := len(r.ExpectStatus) == 0
	for _, s := range r.ExpectStatus {
		if s == resp.StatusCode {
			ok = true
		}
	}

	res := Result{Stdout: summary}
	if !ok {
		res.ExitCode = 1
		msg := fmt.Sprintf("status %d not in expected %v", resp.StatusCode, r.ExpectStatus)
		res.Stderr = strings.TrimSpace(res.Stderr + "\n" + msg)
		fmt.Fprintln(stderr, msg)
	}
	for _, a := range r.Assert {
		got, found := EvalDotPath(string(raw), a.JSONPath)
		if !found || got != a.Equals {
			res.ExitCode = 1
			msg := fmt.Sprintf("assert failed: %s = %q (want %q)", a.JSONPath, got, a.Equals)
			res.Stderr = strings.TrimSpace(res.Stderr + "\n" + msg)
			fmt.Fprintln(stderr, msg)
		}
	}
	return res
}

// EvalDotPath walks a simple `a.b.0.c` path into parsed JSON. Returns the value
// as a string ("" + false if not found). Not full JSONPath — enough for the
// `assert` checks in R2.
func EvalDotPath(bodyJSON string, path string) (string, bool) {
	var v any
	if err := json.Unmarshal([]byte(bodyJSON), &v); err != nil {
		return "", false
	}
	for _, seg := range strings.Split(strings.TrimPrefix(path, "$."), ".") {
		if seg == "" || seg == "$" {
			continue
		}
		switch cur := v.(type) {
		case map[string]any:
			var ok bool
			v, ok = cur[seg]
			if !ok {
				return "", false
			}
		case []any:
			var idx int
			if _, err := fmt.Sscanf(seg, "%d", &idx); err != nil || idx < 0 || idx >= len(cur) {
				return "", false
			}
			v = cur[idx]
		default:
			return "", false
		}
	}
	switch t := v.(type) {
	case string:
		return t, true
	case float64:
		return fmt.Sprintf("%v", t), true
	case bool:
		return fmt.Sprintf("%v", t), true
	case nil:
		return "", true
	default:
		b, _ := json.Marshal(t)
		return string(b), true
	}
}

// BasicAuthHeader builds the "Basic base64(user:pass)" value.
func BasicAuthHeader(user, pass string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
}
