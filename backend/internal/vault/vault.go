// Package vault stores secrets (passwords, API keys, tokens, kubeconfigs, …)
// for the Runbooks module in a single encrypted file. Master password →
// Argon2id → 32-byte key → AES-256-GCM per secret. The key lives only in
// process memory and is zeroed on Lock / idle-timeout / exit; the master
// password is never persisted. See RUNBOOK_MODULE_PLAN.md §5.2.
package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

// Errors returned by the vault. Callers map these to HTTP status codes.
var (
	ErrNotInitialised = errors.New("vault not initialised")
	ErrLocked         = errors.New("vault is locked")
	ErrBadPassword    = errors.New("wrong master password")
	ErrExists         = errors.New("vault already initialised")
	ErrNoSecret       = errors.New("no such secret")
	ErrNoKeyring      = errors.New("this device has no remembered vault key")

	errKeyringUnsupported = errors.New("OS keyring not supported on this platform")
	errKeyringMissing     = errors.New("keyring entry not found")
)

// SecretKind categorises a secret for the UI.
type SecretKind string

const (
	KindPassword    SecretKind = "password"
	KindAPIKey      SecretKind = "api-key"
	KindToken       SecretKind = "token"
	KindSSHKey      SecretKind = "ssh-key"
	KindKubeconfig  SecretKind = "kubeconfig"
	KindCertificate SecretKind = "certificate"
	KindOther       SecretKind = "other"
)

// SecretMeta is everything about a secret except its value. List/get responses
// never carry the value out of the backend.
type SecretMeta struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Kind      SecretKind `json:"kind"`
	Notes     string     `json:"notes,omitempty"`
	UpdatedAt int64      `json:"updatedAt"`
}

type secretRecord struct {
	Name  string     `json:"name"`
	Kind  SecretKind `json:"kind"`
	Notes string     `json:"notes,omitempty"`
	Value string     `json:"value"`
}

type kdfParams struct {
	Algo string `json:"algo"` // "argon2id"
	Salt string `json:"salt"` // base64
	Time uint32 `json:"t"`
	Mem  uint32 `json:"m"` // KiB
	Par  uint8  `json:"p"`
}

func defaultKDF(salt []byte) kdfParams {
	return kdfParams{Algo: "argon2id", Salt: base64.StdEncoding.EncodeToString(salt), Time: 3, Mem: 64 * 1024, Par: 4}
}

// fileEnvelope is the on-disk JSON.
type fileEnvelope struct {
	V        int               `json:"v"`
	KDF      kdfParams         `json:"kdf"`
	Verifier string            `json:"verifier"` // base64(nonce||GCM(sentinel))
	Meta     map[string]int64  `json:"meta"`     // id -> updatedAt (plaintext, cheap listing without unlock)
	Names    map[string]string `json:"names"`    // id -> name (plaintext, for listing/redaction)
	Kinds    map[string]string `json:"kinds"`    // id -> kind
	Notes    map[string]string `json:"notes"`    // id -> notes
	Secrets  map[string]string `json:"secrets"`  // id -> base64(nonce||GCM(secretRecord json))
}

var sentinel = []byte("infrakit-vault-v1")

// Status is the lightweight state the UI polls.
type Status struct {
	Initialised       bool  `json:"initialised"`
	Unlocked          bool  `json:"unlocked"`
	AutoLockInSec     int   `json:"autoLockInSec"`
	SecretCount       int   `json:"secretCount"`
	AutoLockTotal     int   `json:"autoLockTotalSec"`
	KeyringAvailable  bool  `json:"keyringAvailable"`
	KeyringRemembered bool  `json:"keyringRemembered"`
	LastActivityMs    int64 `json:"-"`
}

// Vault is safe for concurrent use.
type Vault struct {
	mu           sync.Mutex
	path         string
	env          fileEnvelope
	key          []byte // nil when locked
	autoLock     time.Duration
	lastActivity time.Time
}

// Open loads (does not decrypt) the vault file at path. A missing file is fine —
// the vault is then "not initialised" until Init is called.
func Open(path string, autoLock time.Duration) (*Vault, error) {
	v := &Vault{path: path, autoLock: autoLock}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return v, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &v.env); err != nil {
		return nil, fmt.Errorf("parse vault file: %w", err)
	}
	// If the user asked this device to remember the key, unlock without a
	// password — this is the whole point of R4d (survive a backend restart).
	if v.initialised() {
		_ = v.UnlockWithKeyring()
	}
	return v, nil
}

// keyringTarget is the Credential Manager entry name for this vault file.
func (v *Vault) keyringTarget() string {
	return "InfraKitStudio/vault/" + filepath.Base(v.path)
}

func (v *Vault) initialised() bool { return v.env.V != 0 }

// SetAutoLock changes the idle timeout (0 disables auto-lock).
func (v *Vault) SetAutoLock(d time.Duration) {
	v.mu.Lock()
	v.autoLock = d
	v.mu.Unlock()
}

// Status returns the current state, applying auto-lock if the idle window passed.
func (v *Vault) Status() Status {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.maybeAutoLock()
	st := Status{
		Initialised:      v.initialised(),
		Unlocked:         v.key != nil,
		AutoLockTotal:    int(v.autoLock.Seconds()),
		SecretCount:      len(v.env.Secrets),
		KeyringAvailable: keyringSupported,
	}
	if keyringSupported {
		if _, err := keyringGet(v.keyringTarget()); err == nil {
			st.KeyringRemembered = true
		}
	}
	if v.key != nil && v.autoLock > 0 {
		remain := v.autoLock - time.Since(v.lastActivity)
		if remain < 0 {
			remain = 0
		}
		st.AutoLockInSec = int(remain.Seconds())
	}
	return st
}

// Init creates a brand-new vault with the given master password. Fails if one
// already exists.
func (v *Vault) Init(masterPassword string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.initialised() {
		return ErrExists
	}
	if len(masterPassword) < 8 {
		return errors.New("master password must be at least 8 characters")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	kdf := defaultKDF(salt)
	key := deriveKey(masterPassword, kdf)
	verifier, err := seal(key, sentinel)
	if err != nil {
		return err
	}
	v.env = fileEnvelope{
		V: 1, KDF: kdf, Verifier: verifier,
		Meta: map[string]int64{}, Names: map[string]string{}, Kinds: map[string]string{},
		Notes: map[string]string{}, Secrets: map[string]string{},
	}
	v.key = key
	v.lastActivity = time.Now()
	return v.persist()
}

// Unlock derives the key from the master password and verifies it.
func (v *Vault) Unlock(masterPassword string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.initialised() {
		return ErrNotInitialised
	}
	key := deriveKey(masterPassword, v.env.KDF)
	plain, err := open(key, v.env.Verifier)
	if err != nil || subtle.ConstantTimeCompare(plain, sentinel) != 1 {
		zero(key)
		return ErrBadPassword
	}
	v.key = key
	v.lastActivity = time.Now()
	return nil
}

// Lock discards the in-memory key.
func (v *Vault) Lock() {
	v.mu.Lock()
	defer v.mu.Unlock()
	zero(v.key)
	v.key = nil
}

// Remember stores the current key in the OS keyring so the vault auto-unlocks
// after a backend restart (R4d). Requires an unlocked vault.
func (v *Vault) Remember() error {
	if !keyringSupported {
		return errKeyringUnsupported
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.maybeAutoLock()
	if v.key == nil {
		return ErrLocked
	}
	stored := make([]byte, len(v.key))
	copy(stored, v.key)
	return keyringSet(v.keyringTarget(), stored)
}

// Forget removes the remembered key from the OS keyring. The vault stays in
// whatever lock state it was in.
func (v *Vault) Forget() error {
	if !keyringSupported {
		return errKeyringUnsupported
	}
	return keyringDelete(v.keyringTarget())
}

// UnlockWithKeyring unlocks using the key remembered in the OS keyring, with no
// master password. Returns ErrNoKeyring if this device has no remembered key
// (or it no longer matches the vault).
func (v *Vault) UnlockWithKeyring() error {
	if !keyringSupported {
		return errKeyringUnsupported
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.initialised() {
		return ErrNotInitialised
	}
	if v.key != nil {
		return nil
	}
	blob, err := keyringGet(v.keyringTarget())
	if err != nil || len(blob) != 32 {
		return ErrNoKeyring
	}
	plain, err := open(blob, v.env.Verifier)
	if err != nil || subtle.ConstantTimeCompare(plain, sentinel) != 1 {
		zero(blob)
		_ = keyringDelete(v.keyringTarget()) // stale entry — drop it
		return ErrNoKeyring
	}
	v.key = blob
	v.lastActivity = time.Now()
	return nil
}

// Touch resets the idle timer (called on any vault access from a request).
func (v *Vault) Touch() {
	v.mu.Lock()
	if v.key != nil {
		v.lastActivity = time.Now()
	}
	v.mu.Unlock()
}

func (v *Vault) maybeAutoLock() {
	if v.key != nil && v.autoLock > 0 && time.Since(v.lastActivity) >= v.autoLock {
		zero(v.key)
		v.key = nil
	}
}

// List returns metadata for every secret (no values). Works while locked —
// names/kinds/notes are stored in the clear so the UI and the redactor can use
// them without a password.
func (v *Vault) List() []SecretMeta {
	v.mu.Lock()
	defer v.mu.Unlock()
	out := make([]SecretMeta, 0, len(v.env.Secrets))
	for id := range v.env.Secrets {
		out = append(out, SecretMeta{
			ID: id, Name: v.env.Names[id], Kind: SecretKind(v.env.Kinds[id]),
			Notes: v.env.Notes[id], UpdatedAt: v.env.Meta[id],
		})
	}
	return out
}

// Put creates or replaces a secret. Requires an unlocked vault.
func (v *Vault) Put(id, name string, kind SecretKind, notes, value string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.maybeAutoLock()
	if v.key == nil {
		return "", ErrLocked
	}
	if id == "" {
		id = newID()
	}
	rec := secretRecord{Name: name, Kind: kind, Notes: notes, Value: value}
	raw, _ := json.Marshal(rec)
	ct, err := seal(v.key, raw)
	if err != nil {
		return "", err
	}
	now := time.Now().UnixMilli()
	v.env.Secrets[id] = ct
	v.env.Names[id] = name
	v.env.Kinds[id] = string(kind)
	v.env.Notes[id] = notes
	v.env.Meta[id] = now
	v.lastActivity = time.Now()
	return id, v.persist()
}

// Delete removes a secret.
func (v *Vault) Delete(id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, ok := v.env.Secrets[id]; !ok {
		return ErrNoSecret
	}
	delete(v.env.Secrets, id)
	delete(v.env.Names, id)
	delete(v.env.Kinds, id)
	delete(v.env.Notes, id)
	delete(v.env.Meta, id)
	return v.persist()
}

// Resolve returns the plaintext value of a secret by id. Requires unlock. Used
// only by the run engine, server-side — never sent to the client.
func (v *Vault) Resolve(id string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.maybeAutoLock()
	if v.key == nil {
		return "", ErrLocked
	}
	ct, ok := v.env.Secrets[id]
	if !ok {
		return "", ErrNoSecret
	}
	raw, err := open(v.key, ct)
	if err != nil {
		return "", err
	}
	var rec secretRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return "", err
	}
	v.lastActivity = time.Now()
	return rec.Value, nil
}

// ResolveByName is a convenience for `{{secret:NAME}}` refs.
func (v *Vault) ResolveByName(name string) (string, error) {
	v.mu.Lock()
	var id string
	for sid, sname := range v.env.Names {
		if sname == name {
			id = sid
			break
		}
	}
	v.mu.Unlock()
	if id == "" {
		return "", ErrNoSecret
	}
	return v.Resolve(id)
}

// ExportBytes returns the raw encrypted file for off-machine backup.
func (v *Vault) ExportBytes() ([]byte, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return json.MarshalIndent(v.env, "", "  ")
}

// ImportBytes replaces the local vault after verifying the given master
// password against the incoming file. The vault is left locked.
func (v *Vault) ImportBytes(data []byte, masterPassword string) error {
	var incoming fileEnvelope
	if err := json.Unmarshal(data, &incoming); err != nil {
		return fmt.Errorf("parse imported vault: %w", err)
	}
	if incoming.V == 0 {
		return errors.New("not a vault file")
	}
	key := deriveKey(masterPassword, incoming.KDF)
	plain, err := open(key, incoming.Verifier)
	zero(key)
	if err != nil || subtle.ConstantTimeCompare(plain, sentinel) != 1 {
		return ErrBadPassword
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	zero(v.key)
	v.key = nil
	v.env = incoming
	// The imported vault has a different key — any remembered one is now stale.
	if keyringSupported {
		_ = keyringDelete(v.keyringTarget())
	}
	return v.persist()
}

func (v *Vault) persist() error {
	b, err := json.MarshalIndent(v.env, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(v.path); dir != "." {
		_ = os.MkdirAll(dir, 0o700)
	}
	tmp := v.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, v.path)
}

// --- crypto helpers ---------------------------------------------------------

func deriveKey(password string, p kdfParams) []byte {
	salt, _ := base64.StdEncoding.DecodeString(p.Salt)
	return argon2.IDKey([]byte(password), salt, p.Time, p.Mem, p.Par, 32)
}

func seal(key, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

func open(key []byte, b64 string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "sec_" + base64.RawURLEncoding.EncodeToString(b)
}
