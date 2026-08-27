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
	"syscall"
	"time"

	"github.com/infrakit/backend/internal/api"
	"github.com/infrakit/backend/internal/history"
	"github.com/infrakit/backend/internal/server"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:0", "host:port to bind (0 = ephemeral port)")
	token := flag.String("token", "", "bearer token required on every request (generated if empty)")
	idleTimeout := flag.Duration("idle-timeout", 0, "exit after this long with no request (0 = never)")
	parentPID := flag.Int("parent-pid", 0, "exit when this process id disappears (0 = disabled)")
	dbPath := flag.String("db", "", `history database path ("" = OS config dir, "off" = no history)`)
	retentionDays := flag.Int("history-retention-days", 90, "default history retention")
	maxPerTarget := flag.Int("history-max-per-target", 20, "default history runs kept per (tool,target)")
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

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("bind %s: %v", *addr, err)
	}

	// The host reads these two lines to learn where to connect.
	fmt.Printf("LISTENING %s\n", ln.Addr().String())
	if generated {
		fmt.Printf("TOKEN %s\n", tok)
	}
	os.Stdout.Sync()

	wd := server.NewWatchdog(*idleTimeout, *parentPID)
	handler := server.NewRouter(server.Options{
		Token:      tok,
		OnActivity: wd.Touch,
		History:    store,
		AppVersion: api.Version,
		HistoryPolicy: history.PrunePolicy{
			RetentionDays: *retentionDays,
			MaxPerTarget:  *maxPerTarget,
		},
	})

	httpServer := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
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

	if err := httpServer.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
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

func mustToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("token: %v", err)
	}
	return hex.EncodeToString(b)
}
