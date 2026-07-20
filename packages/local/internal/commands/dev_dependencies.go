package commands

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/tui"
)

type devDependencies struct {
	browser          tui.BrowserOpener
	serverRunning    func(int) bool
	portAvailable    func(int) bool
	runtimePreflight func(context.Context, *output.IO)
	newServer        func(server.DevServerOptions) devServerSession
	runTUI           func(context.Context, *output.IO, devServerSession, string, int, *startupTracker, <-chan string, tui.BrowserOpener, func() error) error
}

func defaultDevDependencies() devDependencies {
	return devDependencies{
		browser:          platformBrowserOpener(),
		serverRunning:    server.IsServerRunning,
		portAvailable:    server.IsPortAvailable,
		runtimePreflight: printRuntimeDevPreflight,
		newServer: func(options server.DevServerOptions) devServerSession {
			return &nativeDevServerSession{server: server.NewDevServer(options)}
		},
		runTUI: func(ctx context.Context, io *output.IO, session devServerSession, serverURL string, port int, startup *startupTracker, tunnelReady <-chan string, opener tui.BrowserOpener, shutdown func() error) error {
			return runTUI(ctx, io, session.Native(), serverURL, port, startup, tunnelReady, opener, shutdown)
		},
	}
}

func (dependencies devDependencies) withDefaults() devDependencies {
	defaults := defaultDevDependencies()
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
	return dependencies
}
