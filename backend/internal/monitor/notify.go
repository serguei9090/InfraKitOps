package monitor

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/smtp"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/userctx"
)

// SecretResolver resolves a `{{secret:NAME}}` ref from the caller's vault.
type SecretResolver interface {
	ResolveByName(ctx context.Context, name string) (string, error)
}

// Notifier delivers monitor alerts over the owner's configured channel.
type Notifier struct {
	get     func(owner string) Settings
	secrets SecretResolver // nil → `{{secret:}}` refs resolve to ""
}

// NewNotifier wires the alert delivery path. `get` pulls the current settings
// for an owner; `secrets` (may be nil) resolves vault refs.
func NewNotifier(get func(owner string) Settings, secrets SecretResolver) *Notifier {
	return &Notifier{get: get, secrets: secrets}
}

// Send delivers one alert for m. event ∈ {"down","recovered","test"}. channel
// falls back to the owner's DefaultChannel; "none"/"" is a no-op.
func (n *Notifier) Send(ctx context.Context, m Monitor, event, detail string) error {
	set := n.get(m.Owner)
	channel := m.Channel
	if channel == "" {
		channel = set.DefaultChannel
	}
	// resolve secrets in the calling owner's vault scope
	sctx := userctx.With(ctx, m.Owner)

	switch channel {
	case "", "none":
		return nil
	case "webhook":
		return n.sendWebhook(sctx, set.Webhook, m, event, detail)
	case "email":
		return n.sendSMTP(sctx, set.SMTP, m, event, detail)
	case "desktop":
		return nil // handled by the /monitors/stream SSE (M3b)
	default:
		return fmt.Errorf("unknown channel %q", channel)
	}
}

func (n *Notifier) resolveSecret(ctx context.Context, ref string) string {
	ref = strings.TrimSpace(ref)
	if !strings.HasPrefix(ref, "{{secret:") || !strings.HasSuffix(ref, "}}") {
		return ref // literal (or empty)
	}
	name := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(ref, "{{secret:"), "}}"))
	if n.secrets == nil || name == "" {
		return ""
	}
	v, err := n.secrets.ResolveByName(ctx, name)
	if err != nil {
		return ""
	}
	return v
}

func alertLine(m Monitor, event, detail string) (icon, headline string) {
	switch event {
	case "recovered":
		icon = "✅"
		headline = m.Name + " recovered"
	case "test":
		icon = "🔔"
		headline = "Test alert — " + m.Name
	default:
		icon = "🔴"
		headline = m.Name + " is DOWN"
	}
	return
}

// --- webhook ---------------------------------------------------------------

func (n *Notifier) sendWebhook(ctx context.Context, w WebhookSettings, m Monitor, event, detail string) error {
	if strings.TrimSpace(w.URL) == "" {
		return fmt.Errorf("no webhook URL configured")
	}
	icon, headline := alertLine(m, event, detail)
	text := fmt.Sprintf("%s %s\n%s · %s%s", icon, headline, m.Kind, m.Target, nzPrefix("\n", detail))

	var body []byte
	switch w.Format {
	case "slack":
		body, _ = json.Marshal(map[string]string{"text": text})
	case "discord":
		body, _ = json.Marshal(map[string]string{"content": text})
	default: // generic
		body, _ = json.Marshal(map[string]any{
			"monitor": m.Name, "kind": m.Kind, "target": m.Target,
			"event": event, "detail": detail, "at": time.Now().UTC().Format(time.RFC3339),
		})
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if s := n.resolveSecret(ctx, w.Secret); s != "" {
		req.Header.Set("Authorization", "Bearer "+s)
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}

// --- smtp -----------------------------------------------------------------

func (n *Notifier) sendSMTP(ctx context.Context, c SMTPSettings, m Monitor, event, detail string) error {
	if c.Host == "" || c.From == "" || strings.TrimSpace(c.To) == "" {
		return fmt.Errorf("SMTP host, from and to are required")
	}
	port := c.Port
	if port == 0 {
		port = 587
	}
	addr := net.JoinHostPort(c.Host, fmt.Sprint(port))
	pass := n.resolveSecret(ctx, c.Password)

	_, headline := alertLine(m, event, detail)
	to := splitList(c.To)
	msg := buildEmail(c.From, to, "[monitor] "+headline, fmt.Sprintf(
		"%s\n\nkind:   %s\ntarget: %s\nevent:  %s\ndetail: %s\ntime:   %s\n",
		headline, m.Kind, m.Target, event, detail, time.Now().Format(time.RFC1123),
	))

	var auth smtp.Auth
	if c.Username != "" {
		auth = smtp.PlainAuth("", c.Username, pass, c.Host)
	}

	done := make(chan error, 1)
	go func() {
		if c.Security == "tls" {
			done <- sendSMTPImplicitTLS(addr, c.Host, auth, c.From, to, msg)
			return
		}
		// "none" / "starttls" — SendMail negotiates STARTTLS when offered.
		done <- smtp.SendMail(addr, auth, c.From, to, msg)
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return fmt.Errorf("smtp send timed out")
	}
}

func sendSMTPImplicitTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	if err != nil {
		return err
	}
	cl, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer cl.Close()
	if auth != nil {
		if err := cl.Auth(auth); err != nil {
			return err
		}
	}
	if err := cl.Mail(from); err != nil {
		return err
	}
	for _, r := range to {
		if err := cl.Rcpt(r); err != nil {
			return err
		}
	}
	wc, err := cl.Data()
	if err != nil {
		return err
	}
	if _, err := wc.Write(msg); err != nil {
		return err
	}
	if err := wc.Close(); err != nil {
		return err
	}
	return cl.Quit()
}

func buildEmail(from string, to []string, subject, body string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(to, ", "))
	fmt.Fprintf(&b, "Subject: %s\r\n", subject)
	b.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(body)
	return []byte(b.String())
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == ';' }) {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func nzPrefix(prefix, s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return prefix + s
}
