// Command infrakit-backend is the network-tools backend for InfraKit Studio.
// It runs as a Tauri sidecar on the desktop and as a standalone HTTP service
// for the web build (see NETWORK_MODULE_PLAN.md §2.1).
//
// Startup contract with the Tauri host:
//   - bind the address from --addr (default 127.0.0.1:0, an ephemeral port)
//   - print "LISTENING <host:port>" on stdout as the first line
//   - if --token is empty, generate one and print "TOKEN <token>" (dev only;
//     the sidecar is always launched with an explicit token)
//   - exit when idle for --idle-timeout, or when --parent-pid disappears
package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/infrakit/backend/internal/ansible"
	"github.com/infrakit/backend/internal/api"
	"github.com/infrakit/backend/internal/auth"
	"github.com/infrakit/backend/internal/backup"
	"github.com/infrakit/backend/internal/formstore"
	"github.com/infrakit/backend/internal/history"
	"github.com/infrakit/backend/internal/llm"
	"github.com/infrakit/backend/internal/mcp"
	"github.com/infrakit/backend/internal/obs"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/promptstore"
	"github.com/infrakit/backend/internal/runstream"
	"github.com/infrakit/backend/internal/server"
	"github.com/infrakit/backend/internal/tlscert"
	"github.com/infrakit/backend/internal/tools/iperf"
	"github.com/infrakit/backend/internal/userctx"
	"github.com/infrakit/backend/internal/vault"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:0", "host:port to bind (0 = ephemeral port)")
	token := flag.String("token", "", "bearer token required on every request (generated if empty)")
	idleTimeout := flag.Duration("idle-timeout", 0, "exit after this long with no request (0 = never)")
	parentPID := flag.Int("parent-pid", 0, "exit when this process id disappears (0 = disabled)")
	dbPath := flag.String("db", "", `history database path ("" = OS config dir, "off" = no history)`)
	retentionDays := flag.Int("history-retention-days", 90, "default history retention")
	maxPerTarget := flag.Int("history-max-per-target", 20, "default history runs kept per (tool,target)")
	runbookDBPath := flag.String("runbook-db", "", `runbooks database path ("" = OS config dir, "off" = disabled)`)
	llmDBPath := flag.String("llm-db", "", `AI-layer database path ("" = OS config dir, "off" = disabled)`)
	ansibleDBPath := flag.String("ansible-db", "", `Ansible-module database path ("" = OS config dir, "off" = disabled)`)
	vaultPath := flag.String("vault", "", `vault file path ("" = OS config dir, "off" = disabled)`)
	vaultAutoLock := flag.Duration("vault-autolock", 15*time.Minute, "lock the vault after this idle time (0 = never)")
	maxConcurrentRuns := flag.Int("max-concurrent-runs", 4, "cap on runbooks executing at once (0 = unlimited)")
	authMode := flag.String("auth", "off", `"off" = single-user static token; "on" = multi-user sessions`)
	authDBPath := flag.String("auth-db", "", `auth database path ("" = OS config dir)`)
	tlsMode := flag.String("tls", "off", `"off", "auto" (self-signed, pin the printed FINGERPRINT), or a cert file path`)
	tlsKey := flag.String("tls-key", "", "private key file (with --tls <certfile>)")
	dataDir := flag.String("data-dir", "", "directory for all databases + vault.enc (\"\" = OS config dir); individual --*-db flags still win")
	staticDir := flag.String("static-dir", "", "serve the built web frontend from this directory (\"\" = API only)")
	vaultPassphraseFile := flag.String("vault-passphrase-file", "", "unlock (or init) the shared vault at boot from this file's contents (headless deploy)")
	behindProxy := flag.Bool("behind-proxy", false, "a trusted reverse proxy terminates TLS in front of this process (relaxes the non-loopback TLS gate; trusts X-Forwarded-*)")
	logFormat := flag.String("log-format", "text", `log output: "text" (human) or "json"`)
	logLevel := flag.String("log-level", "info", `log level: debug | info | warn | error`)
	errorWebhook := flag.String("error-webhook", "", "POST a JSON blob here on a panic / internal error (Slack incoming webhook or any collector; off when empty)")
	pprofAddr := flag.String("pprof", "", "if set, serve net/http/pprof on this address (bind loopback only, e.g. 127.0.0.1:6060)")
	backupDir := flag.String("backup-dir", "", "if set, write consistent DB+vault snapshots here on a timer")
	backupInterval := flag.Duration("backup-interval", 24*time.Hour, "how often to snapshot when --backup-dir is set")
	backupKeep := flag.Int("backup-keep", 7, "number of snapshot archives to retain (0 = keep all)")
	var corsOrigins multiFlag
	flag.Var(&corsOrigins, "cors-origin", "extra browser origin allowed under --auth on (repeatable)")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	applyEnv(map[string]*string{
		"addr":                  addr,
		"auth":                  authMode,
		"data-dir":              dataDir,
		"static-dir":            staticDir,
		"tls":                   tlsMode,
		"tls-key":               tlsKey,
		"vault-passphrase-file": vaultPassphraseFile,
		"log-format":            logFormat,
		"log-level":             logLevel,
		"error-webhook":         errorWebhook,
		"pprof":                 pprofAddr,
		"backup-dir":            backupDir,
	})
	if !flagPassed("behind-proxy") && envTruthy("INFRAKIT_BEHIND_PROXY") {
		*behindProxy = true
	}
	if !flagPassed("backup-interval") {
		if v := os.Getenv("INFRAKIT_BACKUP_INTERVAL"); v != "" {
			if d, err := time.ParseDuration(v); err == nil {
				*backupInterval = d
			}
		}
	}
	if !flagPassed("backup-keep") {
		if v := os.Getenv("INFRAKIT_BACKUP_KEEP"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				*backupKeep = n
			}
		}
	}
	if len(corsOrigins) == 0 {
		if v := os.Getenv("INFRAKIT_CORS_ORIGIN"); v != "" {
			for _, o := range strings.Split(v, ",") {
				if o = strings.TrimSpace(o); o != "" {
					corsOrigins = append(corsOrigins, o)
				}
			}
		}
	}
	if *dataDir != "" {
		dataDirOverride = *dataDir
	}

	if *showVersion {
		fmt.Println(api.Version)
		return
	}

	obs.Setup(os.Stderr, *logFormat, *logLevel)
	obs.SetBuildVersion(api.Version)
	obs.SetErrorWebhook(*errorWebhook)
	if *pprofAddr != "" {
		startPprof(*pprofAddr)
	}

	tok := *token
	generated := false
	if tok == "" {
		tok = mustToken()
		generated = true
	}

	store := openHistory(*dbPath)
	if store != nil {
		defer store.Close()
	}
	orch := openOrchestrator(*runbookDBPath)
	if orch != nil {
		defer orch.Close()
	}
	vlt := openVaultRegistry(*vaultPath, *vaultAutoLock)
	if vlt != nil {
		defer vlt.CloseAll()
		if *vaultPassphraseFile != "" {
			unlockVaultFromFile(vlt, *vaultPassphraseFile)
		}
	} else if *vaultPassphraseFile != "" {
		obs.Fatalf("--vault-passphrase-file set but the vault is disabled (--vault off)")
	}
	var engine *orchestrator.Engine
	if orch != nil {
		var secrets orchestrator.SecretResolver
		if vlt != nil {
			secrets = vlt.Resolver()
		}
		engine = orchestrator.NewEngine(orch, secrets, *maxConcurrentRuns)
		// Stored module settings override the process flags.
		api.ApplyRunbookSettings(orch.GetSettings(), engine, vlt)
		scheduler := orchestrator.NewScheduler(orch, engine)
		scheduler.Start()
		defer scheduler.Stop()
	}

	llmStore := openLLM(*llmDBPath)
	var llmEngine *llm.Engine
	var mcpManager *mcp.Manager
	var llmHistory *llm.History
	var llmUsage *llm.UsageStore
	var promptStore *promptstore.Store
	var formStore *formstore.Store
	if llmStore != nil {
		defer llmStore.Close()

		if *authMode == "on" {
			if ps, err := promptstore.New(llmStore.DB()); err != nil {
				obs.Warnf("prompts: %v (server-side prompt library disabled)", err)
			} else {
				promptStore = ps
			}
			if fs, err := formstore.New(llmStore.DB()); err != nil {
				obs.Warnf("forms: %v (server-side form sharing disabled)", err)
			} else {
				formStore = fs
			}
		}
		var secrets llm.SecretResolver
		if vlt != nil {
			secrets = vlt.Resolver()
		}
		llmEngine = llm.NewEngine(llmStore, secrets)

		if hist, err := llm.NewHistory(llmStore.DB()); err != nil {
			obs.Warnf("llm history: %v (conversation history disabled)", err)
		} else {
			llmHistory = hist
		}

		if us, err := llm.NewUsageStore(llmStore.DB()); err != nil {
			obs.Warnf("llm usage: %v (usage accounting disabled)", err)
		} else {
			llmUsage = us
			llmEngine.SetUsageRecorder(us)
		}

		if mcpStore, err := mcp.NewStore(llmStore.DB()); err != nil {
			obs.Warnf("mcp: %v (mcp disabled)", err)
		} else {
			var mcpSecrets mcp.SecretResolver
			if vlt != nil {
				mcpSecrets = vlt.Resolver()
			}
			mcpManager = mcp.NewManager(mcpStore, mcpSecrets, api.Version)
			defer mcpManager.CloseAll()
			llmEngine.SetToolRunner(mcpToolRunner{mcpManager})
		}
	}
	ansibleStore, ansibleEngine, ansibleRuntime := openAnsible(*ansibleDBPath)
	if ansibleStore != nil {
		defer ansibleStore.Close()
		ansibleSched := ansible.NewScheduler(ansibleStore, ansibleEngine)
		ansibleSched.Start()
		defer ansibleSched.Stop()
		// AN6d — the SSH-node registry backs the "remote" execution runtime.
		if orch != nil {
			ansibleEngine.SetNodeResolver(func(ctx context.Context, nodeID string) (ansible.RemoteTarget, error) {
				n, err := orch.GetNode(userctx.From(ctx), nodeID)
				if err != nil {
					return ansible.RemoteTarget{}, err
				}
				t := ansible.RemoteTarget{Name: n.Name, Host: n.Host, Port: n.Port, User: n.User, HostKeyFP: n.HostKeyFP}
				if n.AuthSecret != "" && vlt != nil {
					v, serr := vlt.Resolver().Resolve(ctx, n.AuthSecret)
					if serr != nil {
						return t, fmt.Errorf("can't read the node's auth secret — vault locked?")
					}
					if n.AuthKind == "key" {
						t.PrivateKey = v
					} else {
						t.Password = v
					}
				}
				return t, nil
			})
		}
	}

	// Background-run registry (BACKGROUND_RUNS_PLAN.md) — a run outlives the
	// request that starts it; its event log lives under <data-dir>/runs/.
	var runHub *runstream.Hub
	if dir, err := appDataDir(); err == nil {
		runHub = runstream.New(dir)
		if ansibleEngine != nil {
			ansibleEngine.SetHub(runHub)
		}
		if engine != nil {
			engine.SetHub(runHub)
		}
		if ansibleStore != nil {
			if n, rerr := ansibleStore.MarkRunningInterrupted(); rerr != nil {
				obs.Warnf("ansible: boot recovery failed: %v", rerr)
			} else if n > 0 {
				obs.Infof("ansible: marked %d interrupted run(s) from a previous process", n)
			}
		}
		if orch != nil {
			if n, rerr := orch.MarkRunningInterrupted(); rerr != nil {
				obs.Warnf("runbooks: boot recovery failed: %v", rerr)
			} else if n > 0 {
				obs.Infof("runbooks: marked %d interrupted run(s) from a previous process", n)
			}
		}
	}

	defer iperf.StopServer() // kill any managed `iperf3 -s` child

	var authSvc *auth.Service
	if *authMode == "on" {
		authStore := openAuth(*authDBPath)
		if authStore == nil {
			obs.Fatal("auth: --auth on but the auth database could not be opened")
		}
		defer authStore.Close()
		svc, err := auth.NewService(authStore)
		if err != nil {
			obs.Fatalf("auth: %v", err)
		}
		authSvc = svc
		// When the first admin is created, claim every pre-auth row for them
		// so existing single-user data isn't stranded (U2).
		svc.OnBootstrap = func(adminID string) {
			if llmStore != nil {
				_ = llmStore.ClaimOrphans(adminID)
			}
			if llmHistory != nil {
				_ = llmHistory.ClaimOrphans(adminID)
			}
			if llmUsage != nil {
				_ = llmUsage.ClaimOrphans(adminID)
			}
			if mcpManager != nil {
				_ = mcpManager.Store().ClaimOrphans(adminID)
			}
			if orch != nil {
				_ = orch.ClaimOrphans(adminID)
			}
			if store != nil {
				_ = store.ClaimOrphans(adminID)
			}
			if promptStore != nil {
				_ = promptStore.ClaimOrphans(adminID)
			}
			if formStore != nil {
				_ = formStore.ClaimOrphans(adminID)
			}
			if ansibleStore != nil {
				_ = ansibleStore.ClaimOrphans(adminID)
			}
		}
		svc.OnUserDeleted = func(uid string) {
			if orch != nil {
				_ = orch.PurgeGranteeShares(uid)
			}
			if promptStore != nil {
				_ = promptStore.PurgeGranteeShares(uid)
			}
			if formStore != nil {
				_ = formStore.PurgeGranteeShares(uid)
			}
		}
		if tok := svc.SetupToken(); tok != "" {
			fmt.Printf("SETUP-TOKEN %s\n", tok)
		}
		obs.Infof("auth: multi-user mode ON")
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		obs.Fatalf("bind %s: %v", *addr, err)
	}

	// TLS (U6). --tls auto self-signs into the config dir; the client pins the
	// printed FINGERPRINT.
	cfgDir, _ := appDataDir()
	tlsHost, _, _ := net.SplitHostPort(*addr)
	cert, fingerprint, terr := tlscert.Load(*tlsMode, cfgDir, *tlsKey, []string{tlsHost})
	if terr != nil {
		obs.Fatalf("tls: %v", terr)
	}
	tlsOn := *tlsMode != "" && *tlsMode != "off"

	// Hard gate: multi-user mode over a non-loopback bind MUST use TLS —
	// passwords and session tokens in clear on a LAN is a non-starter.
	// --behind-proxy asserts TLS is terminated by a trusted reverse proxy in
	// front of this process; downgrade the gate to a warning.
	if *authMode == "on" && !tlsOn && !isLoopback(ln.Addr()) {
		if *behindProxy {
			obs.Warnf("WARNING: --auth on, non-loopback bind (%s), no TLS on this process — trusting --behind-proxy for TLS termination. Do NOT expose this port directly.", ln.Addr())
		} else {
			obs.Fatalf("refusing to start: --auth on with a non-loopback bind (%s) needs --tls (auto or a real cert), or --behind-proxy if a trusted reverse proxy terminates TLS", ln.Addr())
		}
	}
	if *behindProxy {
		server.SetTrustProxy(true)
	}

	// The host reads these lines to learn where + how to connect.
	fmt.Printf("LISTENING %s\n", ln.Addr().String())
	if generated {
		fmt.Printf("TOKEN %s\n", tok)
	}
	if tlsOn {
		fmt.Printf("FINGERPRINT %s\n", fingerprint)
		api.TLSFingerprint = fingerprint
	}
	os.Stdout.Sync()

	var backupSched *backup.Scheduler
	if *backupDir != "" {
		if dir, err := appDataDir(); err == nil {
			backupSched = &backup.Scheduler{
				DataDir:  dir,
				OutDir:   *backupDir,
				Version:  api.Version,
				Interval: *backupInterval,
				Keep:     *backupKeep,
			}
		} else {
			obs.Warnf("backup: cannot resolve data dir: %v (backups disabled)", err)
		}
	}

	wd := server.NewWatchdog(*idleTimeout, *parentPID)
	handler := server.NewRouter(server.Options{
		Token:          tok,
		Auth:           authSvc,
		Backup:         backupSched,
		CORSOrigins:    corsOrigins,
		TrustProxy:     *behindProxy,
		OnActivity:     wd.Touch,
		History:        store,
		Orchestrator:   orch,
		RunbookEngine:  engine,
		Vault:          vlt,
		LLM:            llmStore,
		LLMEngine:      llmEngine,
		MCP:            mcpManager,
		LLMHistory:     llmHistory,
		LLMUsage:       llmUsage,
		Prompts:        promptStore,
		Forms:          formStore,
		AnsibleStore:   ansibleStore,
		AnsibleEngine:  ansibleEngine,
		AnsibleRuntime: ansibleRuntime,
		RunHub:         runHub,
		AppVersion:     api.Version,
		HistoryPolicy: history.PrunePolicy{
			RetentionDays: *retentionDays,
			MaxPerTarget:  *maxPerTarget,
		},
	})

	if *staticDir != "" {
		handler = server.StaticHandler(*staticDir, handler)
		obs.Infof("web: serving frontend from %s", *staticDir)
	}

	httpServer := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if tlsOn {
		httpServer.TLSConfig = &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if backupSched != nil {
		go backupSched.Run(ctx)
	}

	// Watchdog and signals both trigger the same graceful shutdown.
	go func() {
		wd.Run(ctx)
		stop()
	}()

	go func() {
		<-ctx.Done()
		if runHub != nil {
			runHub.CancelAll() // stop in-flight background runs before exit
		}
		if backupSched != nil {
			if p, err := backupSched.Once(); err != nil {
				slog.Warn("shutdown backup failed", "err", err)
			} else {
				slog.Info("shutdown backup written", "archive", p)
			}
		}
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	serve := httpServer.Serve
	if tlsOn {
		serve = func(l net.Listener) error { return httpServer.ServeTLS(l, "", "") }
	}
	if err := serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		obs.Fatalf("serve: %v", err)
	}
}

// multiFlag collects a repeatable string flag.
type multiFlag []string

func (m *multiFlag) String() string { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error {
	*m = append(*m, v)
	return nil
}

// flagPassed reports whether the named flag was given explicitly on the
// command line (as opposed to sitting at its default).
func flagPassed(name string) bool {
	seen := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == name {
			seen = true
		}
	})
	return seen
}

// envTruthy reports whether an env var holds an affirmative value.
func envTruthy(name string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// applyEnv fills each string flag from INFRAKIT_<FLAG> (dashes → underscores,
// upper-cased) when the flag was NOT passed explicitly on the command line.
// An explicit flag always wins (DEPLOY_PLAN.md D0).
func applyEnv(flags map[string]*string) {
	for name, target := range flags {
		if flagPassed(name) {
			continue
		}
		env := "INFRAKIT_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
		if v := os.Getenv(env); v != "" {
			*target = v
		}
	}
}

// unlockVaultFromFile reads a passphrase file and unlocks — or, on a brand-new
// vault, initialises — the shared vault, so a headless deploy comes up ready
// (DEPLOY_PLAN.md D1). Fatal on a misconfiguration: the operator asked for an
// auto-unlock and it must work.
func unlockVaultFromFile(reg *vault.Registry, path string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		obs.Fatalf("vault-passphrase-file: %v", err)
	}
	pw := strings.TrimRight(string(raw), "\r\n")
	if pw == "" {
		obs.Fatalf("vault-passphrase-file %s: empty", path)
	}
	v := reg.For("") // the shared / single-user vault
	st := v.Status()
	switch {
	case st.Unlocked:
		obs.Warnf("vault: already unlocked (keyring); passphrase file ignored")
	case !st.Initialised:
		if err := v.Init(pw); err != nil {
			obs.Fatalf("vault: init from passphrase file: %v", err)
		}
		obs.Infof("vault: initialised + unlocked from passphrase file")
	default:
		if err := v.Unlock(pw); err != nil {
			obs.Fatalf("vault: unlock from passphrase file: %v", err)
		}
		obs.Infof("vault: unlocked from passphrase file")
	}
}

// dataDirOverride, when non-empty, replaces the OS config dir for every
// database + the vault (set from --data-dir / INFRAKIT_DATA_DIR).
var dataDirOverride string

func isLoopback(a net.Addr) bool {
	host, _, err := net.SplitHostPort(a.String())
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// openHistory resolves the database path and opens the store. A failure is
// logged but not fatal — the tools run without history rather than not at all.
func openHistory(path string) *history.Store {
	if path == "off" {
		return nil
	}
	if path == "" {
		appDir, err := appDataDir()
		if err != nil {
			obs.Warnf("history: cannot resolve config dir: %v (history disabled)", err)
			return nil
		}
		path = filepath.Join(appDir, "history.db")
	}
	store, err := history.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		obs.Warnf("history: open %s: %v (history disabled)", path, err)
		return nil
	}
	obs.Infof("history: %s", path)
	return store
}

// appDataDir returns the data directory (--data-dir when set, else
// %AppData%/InfraKitStudio or the OS equivalent), created.
func appDataDir() (string, error) {
	if dataDirOverride != "" {
		return dataDirOverride, os.MkdirAll(dataDirOverride, 0o755)
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	d := filepath.Join(dir, "InfraKitStudio")
	return d, os.MkdirAll(d, 0o755)
}

// openOrchestrator resolves the runbooks DB path and opens the store.
// A failure is logged, not fatal — the module then reports unavailable.
func openOrchestrator(path string) *orchestrator.Store {
	if path == "off" {
		return nil
	}
	if path == "" {
		d, err := appDataDir()
		if err != nil {
			obs.Warnf("runbooks: config dir: %v (module disabled)", err)
			return nil
		}
		path = filepath.Join(d, "orchestrator.db")
	}
	s, err := orchestrator.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		obs.Warnf("runbooks: open %s: %v (module disabled)", path, err)
		return nil
	}
	obs.Infof("runbooks: %s", path)
	return s
}

// openLLM resolves the AI-layer DB path and opens the store. A failure is
// logged, not fatal — the /llm endpoints then 503 and the UI shows the
// connect state.
func openLLM(path string) *llm.Store {
	if path == "off" {
		return nil
	}
	if path == "" {
		d, err := appDataDir()
		if err != nil {
			obs.Warnf("llm: config dir: %v (module disabled)", err)
			return nil
		}
		path = filepath.Join(d, "llm.db")
	}
	s, err := llm.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		obs.Warnf("llm: open %s: %v (module disabled)", path, err)
		return nil
	}
	obs.Infof("llm: %s", path)
	return s
}

// openAnsible resolves the Ansible-module DB path, opens the store, and builds
// the runtime + run engine. A failure is logged, not fatal — the /ansible
// endpoints then 503 and the UI shows the connect state.
func openAnsible(path string) (*ansible.Store, *ansible.Engine, *ansible.Runtime) {
	if path == "off" {
		return nil, nil, nil
	}
	cfgDir, err := appDataDir()
	if err != nil {
		obs.Warnf("ansible: config dir: %v (module disabled)", err)
		return nil, nil, nil
	}
	if path == "" {
		path = filepath.Join(cfgDir, "ansible.db")
	}
	s, err := ansible.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		obs.Warnf("ansible: open %s: %v (module disabled)", path, err)
		return nil, nil, nil
	}
	rt := ansible.NewRuntime(cfgDir)
	eng, err := ansible.NewEngine(s, rt, cfgDir)
	if err != nil {
		obs.Warnf("ansible: engine: %v (module disabled)", err)
		_ = s.Close()
		return nil, nil, nil
	}
	obs.Infof("ansible: %s", path)
	return s, eng, rt
}

// openAuth resolves the auth DB path and opens the store. Fatal on failure —
// --auth on with no usable store is a misconfiguration, not a soft-degrade.
func openAuth(path string) *auth.Store {
	if path == "" {
		d, err := appDataDir()
		if err != nil {
			obs.Infof("auth: config dir: %v", err)
			return nil
		}
		path = filepath.Join(d, "auth.db")
	}
	s, err := auth.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		obs.Infof("auth: open %s: %v", path, err)
		return nil
	}
	obs.Infof("auth: %s", path)
	return s
}

// openVaultRegistry resolves the vault location and returns a per-user
// registry (U2). Single-user mode uses exactly one vault at <path>; multi-user
// mode adds vault/<userID>.enc siblings.
func openVaultRegistry(path string, autoLock time.Duration) *vault.Registry {
	if path == "off" {
		return nil
	}
	if path == "" {
		d, err := appDataDir()
		if err != nil {
			obs.Warnf("vault: config dir: %v (vault disabled)", err)
			return nil
		}
		path = filepath.Join(d, "vault.enc")
	}
	obs.Infof("vault: %s (+ vault/ per user)", path)
	return vault.NewRegistry(path, autoLock)
}

// startPprof serves net/http/pprof on its own listener — never on the main
// mux. The operator is expected to bind loopback (e.g. 127.0.0.1:6060).
func startPprof(addr string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	slog.Warn("pprof enabled — do not expose this port", "addr", addr)
	go func() {
		s := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
		if err := s.ListenAndServe(); err != nil {
			slog.Warn("pprof server stopped", "err", err)
		}
	}()
}

func mustToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		obs.Fatalf("token: %v", err)
	}
	return hex.EncodeToString(b)
}

// mcpToolRunner adapts *mcp.Manager to llm.ToolRunner (keeps internal/llm from
// depending on internal/mcp directly).
type mcpToolRunner struct{ m *mcp.Manager }

func (r mcpToolRunner) Call(ctx context.Context, serverID, tool string, args map[string]any) (llm.ToolCallOutput, error) {
	res, err := r.m.Call(ctx, serverID, tool, args)
	return llm.ToolCallOutput{Text: res.Text, IsError: res.IsError, Truncated: res.Truncated}, err
}
