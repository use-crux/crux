package commands

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/tui"
)

type devDependencies struct {
	browser                tui.BrowserOpener
	serverRunning          func(int) bool
	portAvailable          func(int) bool
	runtimePreflight       func(context.Context, *output.IO)
	runtimePreflightStatus func(context.Context, *output.IO) []startup.Diagnostic
	newServer              func(server.DevServerOptions) devServerSession
	runTUI                 func(context.Context, *output.IO, devServerSession, string, int, *startupTracker, <-chan string, tui.BrowserOpener, func() error) error
	shutdownTimeout        time.Duration
}

func defaultDevDependencies() devDependencies {
	return devDependencies{
		browser:                platformBrowserOpener(),
		serverRunning:          server.IsServerRunning,
		portAvailable:          server.IsPortAvailable,
		runtimePreflight:       func(ctx context.Context, io *output.IO) { _ = printRuntimeDevPreflight(ctx, io) },
		runtimePreflightStatus: printRuntimeDevPreflight,
		newServer: func(options server.DevServerOptions) devServerSession {
			return &nativeDevServerSession{server: server.NewDevServer(options)}
		},
		runTUI: func(ctx context.Context, io *output.IO, session devServerSession, serverURL string, port int, startup *startupTracker, tunnelReady <-chan string, opener tui.BrowserOpener, shutdown func() error) error {
			return runTUI(ctx, io, session.Native(), serverURL, port, startup, tunnelReady, opener, shutdown)
		},
		shutdownTimeout: 3 * time.Second,
	}
}

func (dependencies devDependencies) withDefaults() devDependencies {
	defaults := defaultDevDependencies()
	if dependencies.runtimePreflightStatus == nil {
		if injected := dependencies.runtimePreflight; injected != nil {
			dependencies.runtimePreflightStatus = func(ctx context.Context, io *output.IO) []startup.Diagnostic {
				injected(ctx, io)
				return nil
			}
		} else {
			dependencies.runtimePreflightStatus = defaults.runtimePreflightStatus
		}
	}
	if dependencies.serverRunning == nil {
		dependencies.serverRunning = defaults.serverRunning
	}
	if dependencies.portAvailable == nil {
		dependencies.portAvailable = defaults.portAvailable
	}
	if dependencies.runtimePreflight == nil {
		dependencies.runtimePreflight = defaults.runtimePreflight
	}
	if dependencies.newServer == nil {
		dependencies.newServer = defaults.newServer
	}
	if dependencies.runTUI == nil {
		dependencies.runTUI = defaults.runTUI
	}
	if dependencies.shutdownTimeout <= 0 {
		dependencies.shutdownTimeout = defaults.shutdownTimeout
	}
	return dependencies
}
