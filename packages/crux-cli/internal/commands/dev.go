// Package commands implements CLI subcommands for the crux devtools.
package commands

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/devtools"
	"github.com/anthropics/crux-cli/internal/output"
	"github.com/anthropics/crux-cli/internal/server"
	"github.com/anthropics/crux-cli/internal/tui"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
)

type startupTracker struct {
	enabled bool
	started time.Time
	mu      sync.Mutex
	mode    string
	marks   map[string]time.Time
}

func newStartupTracker(enabled bool) *startupTracker {
	return &startupTracker{
		enabled: enabled,
		started: time.Now(),
		marks:   map[string]time.Time{},
	}
}

func (s *startupTracker) Enabled() bool {
	return s != nil && s.enabled
}

func (s *startupTracker) SetMode(mode string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mode = mode
}

func (s *startupTracker) Mode() string {
	if s == nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mode
}

func (s *startupTracker) Mark(name string) {
	if s == nil || !s.enabled {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.marks[name]; exists {
		return
	}
	s.marks[name] = time.Now()
}

func (s *startupTracker) Summary() string {
	if s == nil || !s.enabled {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	steps := []struct {
		name  string
		label string
	}{
		{"Server child spawned", "spawn"},
		{"First server stdout", "stdout"},
		{"First server stderr", "stderr"},
		{"HTTP ready", "http"},
		{"WebSocket connected", "ws"},
		{"Initial data loaded", "data"},
		{"Dashboard visible", "ui"},
	}

	parts := make([]string, 0, len(steps)+2)
	if s.mode != "" {
		parts = append(parts, s.mode)
	}
	for _, step := range steps {
		if at, ok := s.marks[step.name]; ok {
			parts = append(parts, fmt.Sprintf("%s=%s", step.label, at.Sub(s.started).Round(10*time.Millisecond)))
		}
	}
	parts = append(parts, fmt.Sprintf("total=%s", time.Since(s.started).Round(10*time.Millisecond)))
	return strings.Join(parts, "  ")
}

func startupDebugEnabled(flag bool) bool {
	if flag {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CRUX_STARTUP_DEBUG"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// NewDevCmd creates the "crux dev" command for starting the devtools server.
func NewDevCmd() *cobra.Command {
	var port int
	var tunnel bool
	var noOpen bool
	var noTUI bool
	var tuiLegacy bool // deprecated no-op, retained for back-compat
	var startupDebug bool

	cmd := &cobra.Command{
		Use:   "dev",
		Short: "Start the devtools server",
		Long:  "Start the crux devtools HTTP + WebSocket server and open the web UI.",
		RunE: func(cmd *cobra.Command, args []string) error {
			_ = tuiLegacy // accepted for back-compat; TUI is now the default
			ctx := cmd.Context()
			startup := newStartupTracker(startupDebugEnabled(startupDebug))
			serverURL := fmt.Sprintf("http://localhost:%d", port)
			alreadyRunning := server.IsServerRunning(port)
			tuiMode := !noTUI

			if alreadyRunning {
				startup.SetMode("existing-server")
				startup.Mark("HTTP ready")
				fmt.Printf("%s Server already running at %s\n",
					output.Green.Render("OK"),
					output.BoldCyan.Render(serverURL))

				if tuiMode {
					// The TUI owns an in-process dev server (DirectClient
					// talks to native Go services, not HTTP). It can't
					// reuse a foreign process. Help the user clean up.
					fmt.Printf("%s The TUI needs to own the dev server it runs against.\n",
						output.Dim.Render("*"))
					if pid := findListeningPID(port); pid != "" {
						fmt.Printf("%s Listener on port %d is %s\n",
							output.Dim.Render("*"), port, output.BoldCyan.Render("pid "+pid))
						fmt.Printf("    %s %s\n",
							output.Dim.Render("kill it:"),
							output.Accent.Render(killCommand(pid)))
					} else {
						fmt.Printf("%s Find the listener with: %s\n",
							output.Dim.Render("*"),
							output.Accent.Render(findListenerHint(port)))
					}
					fmt.Printf("%s Or run on a different port: %s\n",
						output.Dim.Render("*"),
						output.Accent.Render(fmt.Sprintf("crux dev --port %d", port+1)))
					fmt.Printf("%s Pass %s to use the existing server with the web UI only.\n",
						output.Dim.Render("*"), output.Accent.Render("--no-tui"))
					return fmt.Errorf("port %d already in use", port)
				}
				if !noOpen {
					openBrowser(serverURL)
				}
				if startup.Enabled() {
					fmt.Printf("%s %s\n", output.Dim.Render("*"), output.Fg.Render(startup.Summary()))
				}
				return nil
			}

			// Check port availability and try next port if taken.
			if !server.IsPortAvailable(port) {
				nextPort := port + 1
				for ; nextPort < port+10; nextPort++ {
					if server.IsPortAvailable(nextPort) {
						break
					}
				}
				if nextPort >= port+10 {
					return fmt.Errorf("port %d is in use and no free port found in range %d-%d", port, port, port+9)
				}
				fmt.Printf("%s Port %d is in use, using %d instead\n",
					output.Dim.Render("*"), port, nextPort)
				port = nextPort
				serverURL = fmt.Sprintf("http://localhost:%d", port)
			}

			// Start the Go HTTP/WS server directly (no Node.js subprocess).
			devSrv := server.NewDevServer(server.DevServerOptions{
				Port:   port,
				Tunnel: tunnel,
				Quiet:  tuiMode,
			})
			if err := devSrv.Start(); err != nil {
				return err
			}
			defer devSrv.Shutdown(context.Background())

			startup.SetMode("go-native")
			startup.Mark("HTTP ready")

			if tuiMode {
				// Start tunnel async — TUI receives URL via callback.
				tunnelReady := make(chan string, 1)
				devSrv.StartTunnel(ctx, func(url string) {
					tunnelReady <- url
				})
				// Open the browser alongside the TUI — they're independent
				// surfaces against the same dev server and can run together.
				if !noOpen {
					openBrowser(serverURL)
				}
				return runTUI(devSrv, serverURL, port, startup, tunnelReady)
			}

			// Non-TUI: start tunnel synchronously (blocks until ready).
			if tunnel {
				fmt.Printf("%s Starting tunnel...\n", output.Dim.Render("*"))
				tunnelDone := make(chan string, 1)
				devSrv.StartTunnel(ctx, func(url string) {
					tunnelDone <- url
				})
				select {
				case url := <-tunnelDone:
					fmt.Printf("%s Tunnel: %s\n",
						output.Green.Render("OK"),
						output.BoldCyan.Render(url))
				case <-time.After(20 * time.Second):
					fmt.Printf("%s Tunnel failed to start within 20s\n", output.Dim.Render("*"))
				}
			}

			fmt.Printf("%s Server ready at %s (%s)\n",
				output.Green.Render("OK"),
				output.BoldCyan.Render(serverURL),
				output.Accent.Render("go-native"))

			if startup.Enabled() {
				fmt.Printf("%s %s\n", output.Dim.Render("*"), output.Fg.Render(startup.Summary()))
			}
			if !noOpen {
				openBrowser(serverURL)
			}

			// Wait for shutdown signal (context already wired from main).
			<-ctx.Done()
			fmt.Printf("\n%s Shutting down...\n", output.Dim.Render("*"))
			return nil
		},
	}

	cmd.Flags().IntVar(&port, "port", 4400, "Server port")
	cmd.Flags().BoolVar(&tunnel, "tunnel", false, "Create a public tunnel")
	cmd.Flags().BoolVar(&noOpen, "no-open", false, "Don't open the browser")
	cmd.Flags().BoolVar(&noTUI, "no-tui", false, "Skip the interactive terminal UI (server-only mode)")
	cmd.Flags().BoolVar(&tuiLegacy, "tui", false, "Deprecated: TUI is now on by default")
	if f := cmd.Flags().Lookup("tui"); f != nil {
		f.Hidden = true
	}
	cmd.Flags().BoolVar(&startupDebug, "startup-debug", false, "Show startup timing diagnostics")

	return cmd
}

func runTUI(devSrv *server.DevServer, serverURL string, port int, startup *startupTracker, tunnelReady <-chan string) error {
	// Server is already running (Go native) — no boot wait needed.
	if devSrv == nil {
		return fmt.Errorf("native TUI requires an owned dev server")
	}
	fmt.Print("\033[K") // Clear line.

	// Pre-alt-screen hint. Alt-screen swaps the terminal buffer, so this
	// line will be visible after the TUI exits — useful for users who
	// don't recognize they've entered a TUI and panic-^C immediately.
	fmt.Printf("%s Workbench starting at %s — %s to quit, %s for help · web UI also at %s\n",
		output.Accent.Render("◆"),
		output.BoldCyan.Render(serverURL),
		output.Accent.Render("q"),
		output.Accent.Render("?"),
		output.BoldCyan.Render(serverURL),
	)

	// Phase 3: Launch Bubbletea TUI (server is ready, WS connected).
	c := devtools.NewDirectClientFromService(devSrv.Devtools).WithObservability(devSrv.Observability)
	app := tui.NewApp(serverURL, c, startup.Mode(), startup.Enabled())

	// Mark boot as complete immediately — server is already up.
	app.MarkBootComplete()

	p := tea.NewProgram(app, tea.WithAltScreen())
	app.SetProgram(p)

	// Pipe local store and quality events into the TUI without a WebSocket round-trip.
	// The store-change channel covers generic state writes; the quality event
	// bus carries typed Quality events (insight added, experiment completed,
	// feedback received, …) that screens can react to selectively.
	go func() {
		sub := devSrv.Devtools.SubscribeChanges()
		for range sub {
			app.SendStoreChanged()
		}
	}()
	go func() {
		events := devSrv.Devtools.Quality().Events().Subscribe(context.Background())
		for ev := range events {
			app.SendQualityEvent(ev)
		}
	}()
	if devSrv.Observability != nil {
		go func() {
			events := devSrv.Observability.Events().Subscribe(context.Background())
			for ev := range events {
				app.SendQualityEvent(api.QualityEvent{
					Tag:       "QualityEvent",
					ID:        ev.ID,
					Timestamp: ev.Timestamp,
					Kind:      "observability",
					Action:    ev.Action,
					Severity:  ev.Severity,
					RefID:     ev.RefID,
					Payload:   ev.Payload,
				})
			}
		}()
	}

	// Send tunnel URL to TUI when it's ready.
	if tunnelReady != nil {
		go func() {
			if url, ok := <-tunnelReady; ok && url != "" {
				app.SendTunnelURL(url)
			}
		}()
	}

	// Signal handler — kill TUI and trigger an explicit server shutdown so
	// the listener releases the port before this process exits. Without
	// this, pnpm/cobra can race the deferred Shutdown and leave a zombie
	// listener on 4400 after ^C.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		signal.Stop(sigCh)
		if p != nil {
			p.Kill()
		}
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = devSrv.Shutdown(shutdownCtx)
	}()

	_, err := p.Run()
	// Make sure the listener is released even on a clean tea exit.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = devSrv.Shutdown(shutdownCtx)
	fmt.Printf("%s Workbench closed. Dev server stopped.\n", output.Dim.Render("*"))
	return err
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	default:
		return
	}
	cmd.Start()
}
