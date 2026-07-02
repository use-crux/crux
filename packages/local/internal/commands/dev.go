// Package commands implements CLI subcommands for the crux devtools.
package commands

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
	qualityserver "github.com/use-crux/crux/packages/local/internal/server/quality"
	"github.com/use-crux/crux/packages/local/internal/tui"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

// NewDevCmd creates the "crux dev" command for starting the devtools server.
func NewDevCmd(f *cli.Factory) *cobra.Command {
	if f == nil {
		f = &cli.Factory{}
	}
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
			io := f.Streams()
			startup := newStartupTracker(startupDebugEnabled(startupDebug))
			serverURL := fmt.Sprintf("http://localhost:%d", port)
			alreadyRunning := server.IsServerRunning(port)
			tuiMode := !noTUI
			printRuntimeDevPreflight(ctx)

			if alreadyRunning {
				startup.SetMode("existing-server")
				startup.Mark("HTTP ready")
				devStatusf(io, "%s Server already running at %s\n",
					devOK(io),
					devStrong(io, serverURL))

				if tuiMode {
					// The TUI owns an in-process dev server (DirectClient
					// talks to native Go services, not HTTP). It can't
					// reuse a foreign process. Help the user clean up.
					devStatusf(io, "%s The TUI needs to own the dev server it runs against.\n",
						devBullet(io))
					if pid := findListeningPID(port); pid != "" {
						devStatusf(io, "%s Listener on port %d is %s\n",
							devBullet(io), port, devStrong(io, "pid "+pid))
						devStatusf(io, "    %s %s\n",
							io.Sprint(output.Dim, "kill it:"),
							devAccent(io, killCommand(pid)))
					} else {
						devStatusf(io, "%s Find the listener with: %s\n",
							devBullet(io),
							devAccent(io, findListenerHint(port)))
					}
					devStatusf(io, "%s Or run on a different port: %s\n",
						devBullet(io),
						devAccent(io, fmt.Sprintf("crux dev --port %d", port+1)))
					devStatusf(io, "%s Pass %s to use the existing server with the web UI only.\n",
						devBullet(io), devAccent(io, "--no-tui"))
					return fmt.Errorf("port %d already in use", port)
				}
				if !noOpen {
					openBrowser(serverURL)
				}
				if startup.Enabled() {
					devStatusf(io, "%s %s\n", devBullet(io), devText(io, startup.Summary()))
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
				devStatusf(io, "%s Port %d is in use, using %d instead\n",
					devBullet(io), port, nextPort)
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

			// When the listener is exposed beyond loopback (CRUX_HOST), surface
			// the tokenized URL so a manually copied link still authenticates.
			if devSrv.LocalGated() {
				devStatusf(io, "%s Network exposure enabled — authenticated URL: %s\n",
					devBullet(io),
					devStrong(io, devSrv.LocalURL()))
			}

			if tuiMode {
				// Start tunnel async — TUI receives URL via callback.
				tunnelReady := make(chan string, 1)
				devSrv.StartTunnel(ctx, func(url string) {
					tunnelReady <- url
				})
				// Open the browser alongside the TUI — they're independent
				// surfaces against the same dev server and can run together.
				if !noOpen {
					openBrowser(devSrv.LocalURL())
				}
				return runTUI(io, devSrv, serverURL, port, startup, tunnelReady)
			}

			printIngestTokenHint(io, devSrv)

			// Non-TUI: start tunnel synchronously (blocks until ready).
			if tunnel {
				devStatusf(io, "%s Starting tunnel...\n", devBullet(io))
				tunnelDone := make(chan string, 1)
				devSrv.StartTunnel(ctx, func(url string) {
					tunnelDone <- url
				})
				select {
				case url := <-tunnelDone:
					devStatusf(io, "%s Tunnel: %s\n",
						devOK(io),
						devStrong(io, url))
				case <-time.After(20 * time.Second):
					devStatusf(io, "%s Tunnel failed to start within 20s\n", devBullet(io))
				}
			}

			devStatusf(io, "%s Server ready at %s (%s)\n",
				devOK(io),
				devStrong(io, serverURL),
				devAccent(io, "go-native"))

			if startup.Enabled() {
				devStatusf(io, "%s %s\n", devBullet(io), devText(io, startup.Summary()))
			}
			if !noOpen {
				openBrowser(devSrv.LocalURL())
			}

			// Wait for shutdown signal (context already wired from main).
			<-ctx.Done()
			devStatusf(io, "\n%s Shutting down...\n", devBullet(io))
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

func printIngestTokenHint(io *output.IO, devSrv *server.DevServer) {
	if devSrv == nil || devSrv.IngestToken == "" {
		return
	}
	suffix := ""
	if devSrv.IngestTokenPath != "" {
		suffix = fmt.Sprintf(" (saved at %s)", devText(io, devSrv.IngestTokenPath))
	}
	devStatusf(io, "%s Remote observability ingest: %s%s\n",
		devBullet(io),
		devStrong(io, "CRUX_DEVTOOLS_TOKEN="+devSrv.IngestToken),
		suffix)
}

func runTUI(io *output.IO, devSrv *server.DevServer, serverURL string, port int, startup *startupTracker, tunnelReady <-chan string) error {
	// Server is already running (Go native) — no boot wait needed.
	if devSrv == nil {
		return fmt.Errorf("native TUI requires an owned dev server")
	}
	io.NewStatusLine().Clear()

	// Pre-alt-screen hint. Alt-screen swaps the terminal buffer, so this
	// line will be visible after the TUI exits — useful for users who
	// don't recognize they've entered a TUI and panic-^C immediately.
	devStatusf(io, "%s Workbench starting at %s — %s to quit, %s for help · web UI also at %s\n",
		devAccent(io, "◆"),
		devStrong(io, serverURL),
		devAccent(io, "q"),
		devAccent(io, "?"),
		devStrong(io, serverURL),
	)
	printIngestTokenHint(io, devSrv)

	// Phase 3: Launch Bubbletea TUI (server is ready, WS connected).
	// Promotion spawns the embedded quality worker through the server-owned
	// Quality bridge. Empty root/config let the worker run in the process cwd
	// and auto-discover crux.config.ts.
	c := devtools.NewDirectClientFromService(devSrv.Devtools).
		WithObservability(devSrv.Observability).
		WithQualityPromote(func(ctx context.Context, experimentID, variant, pinID string) (api.QualityPromoteResult, error) {
			return qualityserver.RunPromote(ctx, "", "", qualityserver.RunnerDeps{
				FindNode:      assets.FindNode,
				ExtractRunner: assets.ExtractEmbeddedQualityRunner,
			}, qualityserver.PromoteRequest{
				ExperimentID: experimentID,
				Variant:      variant,
				PinID:        pinID,
			})
		})
	app := tui.NewApp(serverURL, c, startup.Mode(), startup.Enabled())
	app.SendIngestToken(devSrv.IngestToken, devSrv.IngestTokenPath)

	// Mark boot as complete immediately — server is already up.
	app.MarkBootComplete()

	p := tea.NewProgram(app)
	app.SetProgram(p)

	// Pipe in-process event buses into the TUI without a WebSocket round-trip.
	bridgeCtx, stopBridge := context.WithCancel(context.Background())
	sources := bridge.Sources{
		StoreChanged: devSrv.Devtools.SubscribeChanges(),
		Quality:      devSrv.Devtools.Quality().Events().Subscribe(bridgeCtx),
		IndexChanged: devSrv.Devtools.IndexEvents().Subscribe(bridgeCtx),
	}
	if devSrv.Observability != nil {
		sources.Observability = devSrv.Observability.Events().Subscribe(bridgeCtx)
	}
	bridge.Start(bridgeCtx, sources, app.SendMsg)

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
	stopBridge()
	// Make sure the listener is released even on a clean tea exit.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = devSrv.Shutdown(shutdownCtx)
	devStatusf(io, "%s Workbench closed. Dev server stopped.\n", devBullet(io))
	return err
}
