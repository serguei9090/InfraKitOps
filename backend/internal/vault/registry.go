package vault

import (
	"context"
	"log"
	"path/filepath"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/userctx"
)

// Registry owns one *Vault per user (USER_MANAGEMENT_PLAN.md U2). In
// single-user mode there is exactly one entry, keyed by "", backed by the
// legacy vault.enc — byte-identical to before.
//
// Per-user vaults live next to it as vault/<userID>.enc, each with its own
// passphrase, RAM key and auto-lock timer, so a user's secrets are
// cryptographically theirs — an admin can reset a login but never read
// another user's vault.
type Registry struct {
	legacyPath string
	perUserDir string
	autoLock   time.Duration

	mu     sync.Mutex
	vaults map[string]*Vault
}

// NewRegistry builds a registry. legacyPath is the single-user vault.enc
// location; per-user files go in <dir(legacyPath)>/vault/.
func NewRegistry(legacyPath string, autoLock time.Duration) *Registry {
	return &Registry{
		legacyPath: legacyPath,
		perUserDir: filepath.Join(filepath.Dir(legacyPath), "vault"),
		autoLock:   autoLock,
		vaults:     map[string]*Vault{},
	}
}

func (r *Registry) pathFor(userID string) string {
	if userID == "" {
		return r.legacyPath
	}
	return filepath.Join(r.perUserDir, userID+".enc")
}

// For returns the vault for a user, opening it on first use. A corrupt file
// yields an empty in-memory vault (logged) rather than a nil — the same
// soft-degrade the single-user path already had.
func (r *Registry) For(userID string) *Vault {
	r.mu.Lock()
	defer r.mu.Unlock()
	if v := r.vaults[userID]; v != nil {
		return v
	}
	v, err := Open(r.pathFor(userID), r.autoLock)
	if err != nil {
		log.Printf("vault: open %s: %v (starting empty)", r.pathFor(userID), err)
		v = &Vault{path: r.pathFor(userID), autoLock: r.autoLock}
	}
	r.vaults[userID] = v
	return v
}

// SetAutoLock updates the idle timeout on the registry and every open vault.
func (r *Registry) SetAutoLock(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.autoLock = d
	for _, v := range r.vaults {
		v.SetAutoLock(d)
	}
}

// CloseAll locks every open vault (backend exit).
func (r *Registry) CloseAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, v := range r.vaults {
		v.Lock()
	}
}

// Resolver returns a context-scoped secret resolver satisfying the
// SecretResolver interface of internal/llm, internal/mcp and
// internal/orchestrator. It picks the calling user's vault from the context
// (userctx); "" → the shared single-user vault.
func (r *Registry) Resolver() *Resolver { return &Resolver{reg: r} }

// Resolver reads secrets from the context user's vault.
type Resolver struct{ reg *Registry }

func (rr *Resolver) Resolve(ctx context.Context, id string) (string, error) {
	return rr.reg.For(userctx.From(ctx)).Resolve(id)
}

func (rr *Resolver) ResolveByName(ctx context.Context, name string) (string, error) {
	return rr.reg.For(userctx.From(ctx)).ResolveByName(name)
}
