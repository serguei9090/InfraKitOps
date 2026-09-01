// Package apierr is the shared coded-error type for HTTP handlers. It keeps the
// current `{"error": "<human>"}` JSON key and adds an optional `code` +
// `hint`, so a frontend can present "wrong API key" / "endpoint not listening"
// rather than a raw message. See ERROR_HANDLING_PLAN.md.
package apierr

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// Code is the closed classification set shared with the frontend.
type Code string

const (
	CodeAuth        Code = "auth_failed"
	CodeUnreachable Code = "unreachable"
	CodeTimeout     Code = "timeout"
	CodeRateLimited Code = "rate_limited"
	CodeNotFound    Code = "not_found"
	CodeConflict    Code = "conflict"
	CodeValidation  Code = "validation"
	CodeLocked      Code = "locked"
	CodePermission  Code = "permission"
	CodeUpstream    Code = "upstream"
	CodeInternal    Code = "internal"
)

// Error is a coded HTTP error. It marshals as {"code","error","hint"}.
type Error struct {
	Code    Code   `json:"code"`
	Message string `json:"error"`
	Hint    string `json:"hint,omitempty"`
	Status  int    `json:"-"`
}

func (e *Error) Error() string { return e.Message }

func mk(code Code, status int, hint, msg string) *Error {
	if msg == "" {
		msg = string(code)
	}
	return &Error{Code: code, Message: msg, Hint: hint, Status: status}
}

// Constructors. Each carries a sensible default hint; pass "" for msg to use
// the code as the message.
func Auth(msg string) *Error {
	return mk(CodeAuth, http.StatusUnauthorized, "Check the API key or token for this connection.", msg)
}
func Unreachable(msg string) *Error {
	return mk(CodeUnreachable, http.StatusBadGateway, "The service isn't answering at that address. Is it running, and is the URL right?", msg)
}
func Timeout(msg string) *Error {
	return mk(CodeTimeout, http.StatusGatewayTimeout, "The service took too long. Try again, or raise the timeout.", msg)
}
func RateLimited(msg string) *Error {
	return mk(CodeRateLimited, http.StatusTooManyRequests, "The provider is rate-limiting. Wait a moment and retry.", msg)
}
func NotFound(msg string) *Error {
	return mk(CodeNotFound, http.StatusNotFound, "It may have been deleted or renamed. Refresh and try again.", msg)
}
func Conflict(msg string) *Error {
	return mk(CodeConflict, http.StatusConflict, "Something changed underneath. Reload, then try again.", msg)
}
func Validation(msg string) *Error {
	return mk(CodeValidation, http.StatusBadRequest, "Check the values and try again.", msg)
}
func Locked(msg string) *Error {
	return mk(CodeLocked, http.StatusForbidden, "Unlock the Vault, then try again.", msg)
}
func Permission(msg string) *Error {
	return mk(CodePermission, http.StatusForbidden, "You don't have the rights for this — it may need administrator access.", msg)
}
func Upstream(msg string) *Error {
	return mk(CodeUpstream, http.StatusBadGateway, "The provider rejected the request.", msg)
}
func Internal(msg string) *Error {
	return mk(CodeInternal, http.StatusInternalServerError, "Something went wrong on the backend. Check its log.", msg)
}

// Write serializes err with its HTTP status. A plain error becomes Internal.
func Write(w http.ResponseWriter, err error) {
	var e *Error
	if !errors.As(err, &e) {
		e = Internal(err.Error())
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(e)
}

// ClassifyHTTP maps an upstream provider's HTTP status + body into a coded
// error. `label` prefixes the message (e.g. "openai").
func ClassifyHTTP(label string, status int, body string) *Error {
	body = strings.TrimSpace(body)
	msg := label
	if body != "" {
		msg = label + ": " + body
	}
	switch {
	case status == http.StatusUnauthorized:
		return Auth(msg)
	case status == http.StatusForbidden:
		return Permission(msg)
	case status == http.StatusNotFound:
		return NotFound(msg)
	case status == http.StatusTooManyRequests:
		return RateLimited(msg)
	case status >= 500:
		return Upstream(msg)
	default:
		return Upstream(msg)
	}
}

// ClassifyNet maps a transport error (dial / DNS / deadline) into a coded
// error. Returns nil for a cancelled context (the caller should just stop).
func ClassifyNet(err error) *Error {
	if err == nil {
		return nil
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "context canceled"):
		return nil
	case strings.Contains(s, "context deadline exceeded"),
		strings.Contains(s, "timeout"),
		strings.Contains(s, "timed out"),
		strings.Contains(s, "i/o timeout"):
		return Timeout(err.Error())
	case strings.Contains(s, "connection refused"),
		strings.Contains(s, "no such host"),
		strings.Contains(s, "no route to host"),
		strings.Contains(s, "network is unreachable"),
		strings.Contains(s, "connection reset"),
		strings.Contains(s, "actively refused"),
		strings.Contains(s, "eof"):
		return Unreachable(err.Error())
	default:
		return Upstream(err.Error())
	}
}
