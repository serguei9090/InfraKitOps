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
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/infrakit/backend/internal/ansible"
	"github.com/infrakit/backend/internal/api"
	"github.com/infrakit/backend/internal/auth"
	"github.com/infrakit/backend/internal/history"
	"github.com/infrakit/backend/internal/llm"
	"github.com/infrakit/backend/internal/mcp"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/promptstore"
	"github.com/infrakit/backend/internal/server"
	"github.com/infrakit/backend/internal/tlscert"
	"github.com/infrakit/backend/internal/tools/iperf"
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
	var corsOrigins multiFlag
	flag.Var(&corsOrigins, "cors-origin", "extra browser origin allowed under --auth on (repeatable)")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(api.Version)
		return
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
	if llmStore != nil {
		defer llmStore.Close()

		if *authMode == "on" {
			if ps, err := promptstore.New(llmStore.DB()); err != nil {
				log.Printf("prompts: %v (server-side prompt library disabled)", err)
			} else {
				promptStore = ps
			}
		}
		var secrets llm.SecretResolver
		if vlt != nil {
			secrets = vlt.Resolver()
		}
		llmEngine = llm.NewEngine(llmStore, secrets)

		if hist, err := llm.NewHistory(llmStore.DB()); err != nil {
			log.Printf("llm history: %v (conversation history disabled)", err)
		} else {
			llmHistory = hist
		}

		if us, err := llm.NewUsageStore(llmStore.DB()); err != nil {
			log.Printf("llm usage: %v (usage accounting disabled)", err)
		} else {
			llmUsage = us
			llmEngine.SetUsageRecorder(us)
		}

		if mcpStore, err := mcp.NewStore(llmStore.DB()); err != nil {
			log.Printf("mcp: %v (mcp disabled)", err)
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
	}

	defer iperf.StopServer() // kill any managed `iperf3 -s` child

	var authSvc *auth.Service
	if *authMode == "on" {
		authStore := openAuth(*authDBPath)
		if authStore == nil {
			log.Fatal("auth: --auth on but the auth database could not be opened")
		}
		defer authStore.Close()
		svc, err := auth.NewService(authStore)
		if err != nil {
			log.Fatalf("auth: %v", err)
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
			if ansibleStore != nil {
				_ = ansibleStore.ClaimOrphans(adminID)
			}
		}
		if tok := svc.SetupToken(); tok != "" {
			fmt.Printf("SETUP-TOKEN %s\n", tok)
		}
		log.Printf("auth: multi-user mode ON")
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("bind %s: %v", *addr, err)
	}

	// TLS (U6). --tls auto self-signs into the config dir; the client pins the
	// printed FINGERPRINT.
	cfgDir, _ := appDataDir()
	tlsHost, _, _ := net.SplitHostPort(*addr)
	cert, fingerprint, terr := tlscert.Load(*tlsMode, cfgDir, *tlsKey, []string{tlsHost})
	if terr != nil {
		log.Fatalf("tls: %v", terr)
	}
	tlsOn := *tlsMode != "" && *tlsMode != "off"

	// Hard gate: multi-user mode over a non-loopback bind MUST use TLS —
	// passwords and session tokens in clear on a LAN is a non-starter.
	if *authMode == "on" && !tlsOn && !isLoopback(ln.Addr()) {
		log.Fatalf("refusing to start: --auth on with a non-loopback bind (%s) needs --tls (auto or a real cert)", ln.Addr())
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

	wd := server.NewWatchdog(*idleTimeout, *parentPID)
	handler := server.NewRouter(server.Options{
		Token:          tok,
		Auth:           authSvc,
		CORSOrigins:    corsOrigins,
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
		AnsibleStore:   ansibleStore,
		AnsibleEngine:  ansibleEngine,
		AnsibleRuntime: ansibleRuntime,
		AppVersion:     api.Version,
		HistoryPolicy: history.PrunePolicy{
			RetentionDays: *retentionDays,
			MaxPerTarget:  *maxPerTarget,
		},
	})

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

	// Watchdog and signals both trigger the same graceful shutdown.
	go func() {
		wd.Run(ctx)
		stop()
	}()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	serve := httpServer.Serve
	if tlsOn {
		serve = func(l net.Listener) error { return httpServer.ServeTLS(l, "", "") }
	}
	if err := serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
}

// multiFlag collects a repeatable string flag.
type multiFlag []string

func (m *multiFlag) String() string { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error {
	*m = append(*m, v)
	return nil
}

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
		dir, err := os.UserConfigDir()
		if err != nil {
			log.Printf("history: cannot resolve config dir: %v (history disabled)", err)
			return nil
		}
		appDir := filepath.Join(dir, "InfraKitStudio")
		if err := os.MkdirAll(appDir, 0o755); err != nil {
			log.Printf("history: mkdir %s: %v (history disabled)", appDir, err)
			return nil
		}
		path = filepath.Join(appDir, "history.db")
	}
	store, err := history.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Printf("history: open %s: %v (history disabled)", path, err)
		return nil
	}
	log.Printf("history: %s", path)
	return store
}

// appDataDir returns %AppData%/InfraKitStudio (or the OS equivalent), created.
func appDataDir() (string, error) {
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
			log.Printf("runbooks: config dir: %v (module disabled)", err)
			return nil
		}
		path = filepath.Join(d, "orchestrator.db")
	}
	s, err := orchestrator.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Printf("runbooks: open %s: %v (module disabled)", path, err)
		return nil
	}
	log.Printf("runbooks: %s", path)
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
			log.Printf("llm: config dir: %v (module disabled)", err)
			return nil
		}
		path = filepath.Join(d, "llm.db")
	}
	s, err := llm.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Printf("llm: open %s: %v (module disabled)", path, err)
		return nil
	}
	log.Printf("llm: %s", path)
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
		log.Printf("ansible: config dir: %v (module disabled)", err)
		return nil, nil, nil
	}
	if path == "" {
		path = filepath.Join(cfgDir, "ansible.db")
	}
	s, err := ansible.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Printf("ansible: open %s: %v (module disabled)", path, err)
		return nil, nil, nil
	}
	rt := ansible.NewRuntime(cfgDir)
	eng, err := ansible.NewEngine(s, rt, cfgDir)
	if err != nil {
		log.Printf("ansible: engine: %v (module disabled)", err)
		_ = s.Close()
		return nil, nil, nil
	}
	log.Printf("ansible: %s", path)
	return s, eng, rt
}

// openAuth resolves the auth DB path and opens the store. Fatal on failure —
// --auth on with no usable store is a misconfiguration, not a soft-degrade.
func openAuth(path string) *auth.Store {
	if path == "" {
		d, err := appDataDir()
		if err != nil {
			log.Printf("auth: config dir: %v", err)
			return nil
		}
		path = filepath.Join(d, "auth.db")
	}
	s, err := auth.Open("file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		log.Printf("auth: open %s: %v", path, err)
		return nil
	}
	log.Printf("auth: %s", path)
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
			log.Printf("vault: config dir: %v (vault disabled)", err)
			return nil
		}
		path = filepath.Join(d, "vault.enc")
	}
	log.Printf("vault: %s (+ vault/ per user)", path)
	return vault.NewRegistry(path, autoLock)
}

func mustToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("token: %v", err)
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
