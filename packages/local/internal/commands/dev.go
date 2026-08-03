// Package commands implements CLI subcommands for the crux devtools.
package commands

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/lifecycle"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
	startuplifecycle "github.com/use-crux/crux/packages/local/internal/startup"
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
	var forceTUI bool
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
			mode, err := resolveDevMode(devModeInput{
				TUI: forceTUI, NoTUI: noTUI, StdinTTY: io.IsStdinTTY(), StdoutTTY: io.IsStdoutTTY(),
				CI: io.IsCI(), Term: io.Terminal(),
			})
			if err != nil {
				return err
			}
			tuiMode := mode == devModeTUI
			alreadyRunning := dependencies.serverRunning(port)
			sessionWorkers := &lifecycle.Group{}
			joinOwnedByShutdown := false
			sessionCtx, cancelSession := context.WithCancel(context.WithoutCancel(ctx))
			var stopSessionOnce sync.Once
			stopSession := func() {
				stopSessionOnce.Do(func() {
					sessionWorkers.Close()
					cancelSession()
				})
			}
			stopParentCancellation := context.AfterFunc(ctx, stopSession)
			if ctx.Err() != nil {
				stopSession()
			}
			var preflightOutput bytes.Buffer
			preflightIO := *io
			preflightIO.Err = &preflightOutput
			sessionWorkers.Go(func() {
				startup.journal.Update("runtime-preflight", "Checking runtime", startuplifecycle.Active, nil)
				diagnostics := dependencies.runtimePreflightStatus(sessionCtx, &preflightIO)
				disposition := startuplifecycle.Succeeded
				if len(diagnostics) > 0 {
					disposition = startuplifecycle.Degraded
				}
				startup.journal.Update("runtime-preflight", "Checking runtime", disposition, diagnostics)
				if !tuiMode && sessionCtx.Err() == nil && preflightOutput.Len() > 0 {
					_, _ = io.Err.Write(preflightOutput.Bytes())
				}
			})
			defer func() {
				stopParentCancellation()
				stopSession()
				if !joinOwnedByShutdown {
					joinCtx, cancelJoin := context.WithTimeout(context.Background(), dependencies.shutdownTimeout)
					defer cancelJoin()
					_ = sessionWorkers.Wait(joinCtx)
				}
			}()

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
			process := newDevServerProcess(io.Err, startupDebugEnabled(startupDebug))
			devSrv := dependencies.newServer(server.DevServerOptions{
				Context:        sessionCtx,
				Port:           port,
				Tunnel:         tunnel,
				ServerVersion:  cmd.Root().Version,
				Quiet:          tuiMode,
				InspectDir:     inspectDir,
				Logger:         process.logger,
				Stderr:         process.stderr,
				StartupJournal: startup.journal,
				SessionWorkers: sessionWorkers,
			})
			shutdown := newShutdownCoordinator(stopSession, dependencies.shutdownTimeout, func(ctx context.Context) error {
				// The owned DevServer is the sole join owner for SessionWorkers.
				// Waiting the aliased group again creates a second unbounded waiter
				// whenever the common shutdown deadline expires.
				return devSrv.Shutdown(ctx)
			})
			joinOwnedByShutdown = true
			shutdownAndJoin := func() error {
				return shutdown.Shutdown()
			}
			if err := devSrv.Start(); err != nil {
				return errors.Join(err, shutdownAndJoin())
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
				runErr := dependencies.runTUI(sessionCtx, io, devSrv, serverURL, port, startup, tunnelReady, dependencies.browser, shutdownAndJoin)
				cleanupErr := shutdownAndJoin()
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
						return shutdownAndJoin()
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
					return shutdownAndJoin()
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
			return shutdownAndJoin()
		},
	}

	cmd.Flags().IntVar(&port, "port", 4400, "Server port")
	cmd.Flags().BoolVar(&tunnel, "tunnel", false, "Create a public tunnel")
	cmd.Flags().BoolVar(&open, "open", false, "Open browser devtools after startup")
	cmd.Flags().BoolVar(&forceTUI, "tui", false, "Use the interactive terminal UI")
	cmd.Flags().BoolVar(&noTUI, "no-tui", false, "Skip the interactive terminal UI (server-only mode)")
	cmd.Flags().BoolVar(&startupDebug, "startup-debug", false, "Show startup timing diagnostics")
	cmd.MarkFlagsMutuallyExclusive("tui", "no-tui")

	return cmd
}
