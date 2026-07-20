// Package commands implements CLI subcommands for the crux devtools.
package commands

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
)

// NewDevCmd creates the "crux dev" command for starting the devtools server.
func NewDevCmd(f *cli.Factory) *cobra.Command {
	return newDevCmd(f, defaultDevDependencies())
}

func newDevCmd(f *cli.Factory, dependencies devDependencies) *cobra.Command {
	if f == nil {
		f = &cli.Factory{}
	}
	dependencies = dependencies.withDefaults()
	var port int
	var tunnel bool
	var open bool
	var noTUI bool
	var startupDebug bool

	cmd := &cobra.Command{
		Use:   "dev",
		Short: "Start the devtools server",
		Long:  "Start the crux devtools HTTP + WebSocket server.",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			io := f.Streams()
			startup := newStartupTracker(startupDebugEnabled(startupDebug))
			serverURL := fmt.Sprintf("http://localhost:%d", port)
			alreadyRunning := dependencies.serverRunning(port)
			tuiMode := selectDevMode(devModeInput{
				NoTUI: noTUI, StdinTTY: io.IsStdinTTY(), StdoutTTY: io.IsStdoutTTY(),
				CI: io.IsCI(), Term: io.Terminal(),
			}) == devModeTUI
			dependencies.runtimePreflight(ctx, io)

			if alreadyRunning {
				startup.SetMode("existing-server")
				startup.Mark("HTTP ready")
				devStatusf(io, "%s Server already running at %s\n",
					devOK(io),
					devStrong(io, serverURL))
				launchBrowser(ctx, io, open, serverURL, dependencies.browser)

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
				if startup.Enabled() {
					devStatusf(io, "%s %s\n", devBullet(io), devText(io, startup.Summary()))
				}
				return nil
			}

			// Check port availability and try next port if taken.
			if !dependencies.portAvailable(port) {
				nextPort := port + 1
				for ; nextPort < port+10; nextPort++ {
					if dependencies.portAvailable(nextPort) {
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

			root, err := resolveConfigInspectRoot("")
			if err != nil {
				return err
			}
			inspectDir := filepath.Join(root, ".crux", "evals")

			// Start the Go HTTP/WS server directly (no Node.js subprocess).
			sessionCtx, cancelSession := context.WithCancel(ctx)
			process := newDevServerProcess(io.Err, startupDebugEnabled(startupDebug))
			devSrv := dependencies.newServer(server.DevServerOptions{
				Context:    sessionCtx,
				Port:       port,
				Tunnel:     tunnel,
				Quiet:      tuiMode,
				InspectDir: inspectDir,
				Logger:     process.logger,
				Stderr:     process.stderr,
			})
			shutdown := newShutdownCoordinator(cancelSession, 3*time.Second, devSrv.Shutdown)
			if err := devSrv.Start(); err != nil {
				return errors.Join(err, shutdown.Shutdown())
			}

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
				devSrv.StartTunnel(sessionCtx, func(result server.TunnelStartupResult) {
					if result.Err == nil {
						tunnelReady <- result.URL
					}
				})
				launchBrowser(ctx, io, open, devSrv.LocalURL(), dependencies.browser)
				runErr := dependencies.runTUI(sessionCtx, io, devSrv, serverURL, port, startup, tunnelReady, dependencies.browser, shutdown.Shutdown)
				cleanupErr := shutdown.Shutdown()
				if runErr != nil {
					if cleanupErr != nil && !errors.Is(runErr, cleanupErr) {
						return errors.Join(runErr, cleanupErr)
					}
					return runErr
				}
				return cleanupErr
			}

			ingestToken, ingestTokenPath := devSrv.IngestCredentials()
			printIngestTokenHint(io, ingestToken, ingestTokenPath)

			// Non-TUI: start tunnel synchronously (blocks until ready).
			if tunnel {
				devStatusf(io, "%s Starting tunnel...\n", devBullet(io))
				tunnelDone := make(chan server.TunnelStartupResult, 1)
				devSrv.StartTunnel(sessionCtx, func(result server.TunnelStartupResult) {
					tunnelDone <- result
				})
				select {
				case result := <-tunnelDone:
					if errors.Is(result.Err, context.Canceled) || errors.Is(result.Err, context.DeadlineExceeded) {
						devStatusf(io, "\n%s Shutting down...\n", devBullet(io))
						return shutdown.Shutdown()
					}
					if result.Err != nil {
						devStatusf(io, "%s Tunnel failed to start: %v\n", devBullet(io), result.Err)
					} else {
						devStatusf(io, "%s Tunnel: %s\n",
							devOK(io),
							devStrong(io, result.URL))
					}
				case <-sessionCtx.Done():
					devStatusf(io, "\n%s Shutting down...\n", devBullet(io))
					return shutdown.Shutdown()
				}
			}

			devStatusf(io, "%s Server ready at %s (%s)\n",
				devOK(io),
				devStrong(io, serverURL),
				devAccent(io, "go-native"))

			if startup.Enabled() {
				devStatusf(io, "%s %s\n", devBullet(io), devText(io, startup.Summary()))
			}
			launchBrowser(ctx, io, open, devSrv.LocalURL(), dependencies.browser)

			// Wait for shutdown signal (context already wired from main).
			<-sessionCtx.Done()
			devStatusf(io, "\n%s Shutting down...\n", devBullet(io))
			return shutdown.Shutdown()
		},
	}

	cmd.Flags().IntVar(&port, "port", 4400, "Server port")
	cmd.Flags().BoolVar(&tunnel, "tunnel", false, "Create a public tunnel")
	cmd.Flags().BoolVar(&open, "open", false, "Open browser devtools after startup")
	cmd.Flags().BoolVar(&noTUI, "no-tui", false, "Skip the interactive terminal UI (server-only mode)")
	cmd.Flags().BoolVar(&startupDebug, "startup-debug", false, "Show startup timing diagnostics")

	return cmd
}
