package monitor

import (
	"database/sql"
	"encoding/json"
	"errors"
)

// Settings is a per-owner blob controlling how alerts are delivered. Secrets
// (SMTP password, webhook key) are `{{secret:NAME}}` Vault refs, never plaintext.
type Settings struct {
	// DefaultChannel: "" (none) | "webhook" | "email" | "desktop". A monitor's
	// own Channel overrides this.
	DefaultChannel string `json:"defaultChannel"`

	Webhook WebhookSettings `json:"webhook"`
	SMTP    SMTPSettings    `json:"smtp"`

	// AlertAfterSec: wait this long after a monitor goes down before notifying
	// (0 = notify on the down transition). Per-monitor override via the row.
	AlertAfterSec int `json:"alertAfterSec"`
	// RenotifyEverySec: re-notify while still down (0 = once).
	RenotifyEverySec int `json:"renotifyEverySec"`
	// NotifyOnRecovery: send a "recovered" message too (default true).
	NotifyOnRecovery bool `json:"notifyOnRecovery"`
	// RunAllOnStart: probe every monitor once on backend start (default true;
	// a large deployment can turn off the boot probe storm).
	RunAllOnStart bool `json:"runAllOnStart"`
}

type WebhookSettings struct {
	URL    string `json:"url"`
	Format string `json:"format"` // "slack" | "discord" | "generic"
	Secret string `json:"secret"` // {{secret:NAME}} — sent as Authorization: Bearer
}

type SMTPSettings struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Security string `json:"security"` // "none" | "starttls" | "tls"
	Username string `json:"username"`
	Password string `json:"password"` // {{secret:NAME}}
	From     string `json:"from"`
	To       string `json:"to"` // comma-separated
}

// DefaultSettings is what a fresh install / an owner with no row gets.
func DefaultSettings() Settings {
	return Settings{NotifyOnRecovery: true, RunAllOnStart: true}
}

const settingsSchema = `
CREATE TABLE IF NOT EXISTS monitor_settings (
  owner TEXT PRIMARY KEY,
  json  TEXT NOT NULL
);`

// GetSettings returns the owner's settings, or DefaultSettings when unset.
func (s *Store) GetSettings(owner string) (Settings, error) {
	var raw string
	err := s.db.QueryRow(`SELECT json FROM monitor_settings WHERE owner = ?`, owner).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return DefaultSettings(), err
	}
	out := DefaultSettings()
	if uerr := json.Unmarshal([]byte(raw), &out); uerr != nil {
		return DefaultSettings(), uerr
	}
	return out, nil
}

// PutSettings replaces the owner's settings.
func (s *Store) PutSettings(owner string, set Settings) error {
	b, err := json.Marshal(set)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO monitor_settings (owner, json) VALUES (?,?)
		 ON CONFLICT(owner) DO UPDATE SET json = excluded.json`,
		owner, string(b),
	)
	return err
}
