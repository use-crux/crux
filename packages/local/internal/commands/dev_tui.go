package commands

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/tui"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

func printIngestTokenHint(io *output.IO, token, tokenPath string) {
	if token == "" {
		return
	}
	suffix := ""
	if tokenPath != "" {
		suffix = fmt.Sprintf(" (saved at %s)", devText(io, tokenPath))
	}
	devStatusf(io, "%s Remote observability ingest: %s%s\n",
		devBullet(io), devStrong(io, "CRUX_DEVTOOLS_TOKEN="+token), suffix)
}

func newTUIApp(ctx context.Context, serverURL string, client tui.DataClient, startup *startupTracker) *tui.App {
	return tui.NewApp(ctx, serverURL, client, startup.Mode(), startup.Enabled())
}

func newTUIProgram(io *output.IO, app *tui.App) *tea.Program {
	return tea.NewProgram(app, tea.WithInput(io.In), tea.WithOutput(io.Out), tea.WithoutSignalHandler())
}

func runTUI(ctx context.Context, io *output.IO, devSrv *server.DevServer, serverURL string, _ int, startup *startupTracker, tunnelReady <-chan string, opener tui.BrowserOpener, shutdown func() error) error {
	if devSrv == nil {
		return fmt.Errorf("native TUI requires an owned dev server")
	}
	io.NewStatusLine().Clear()
	devStatusf(io, "%s Workbench starting at %s — %s to quit, %s for help · web UI also at %s\n",
		devAccent(io, "◆"), devStrong(io, serverURL), devAccent(io, "q"),
		devAccent(io, "?"), devStrong(io, serverURL))
	printIngestTokenHint(io, devSrv.IngestToken, devSrv.IngestTokenPath)

	c := devtools.NewDirectClientFromService(devSrv.Devtools).WithObservability(devSrv.Observability)
	app := newTUIApp(ctx, serverURL, c, startup)
	app.SetBrowserOpener(devSrv.LocalURL(), opener)
	app.SendIngestToken(devSrv.IngestToken, devSrv.IngestTokenPath)
	app.MarkBootComplete()

	p := newTUIProgram(io, app)
	app.SetProgram(p)

	bridgeCtx, stopBridge := context.WithCancel(ctx)
	defer stopBridge()
	sources := bridge.Sources{
		StoreChanged: devSrv.Devtools.SubscribeChanges(),
		Inspect:      devSrv.Devtools.Inspect().Events().Subscribe(bridgeCtx),
		IndexChanged: devSrv.Devtools.IndexEvents().Subscribe(bridgeCtx),
	}
	if devSrv.Observability != nil {
		sources.Observability = devSrv.Observability.Events().Subscribe(bridgeCtx)
	}
	bridgeSession := bridge.Start(bridgeCtx, sources, app.SendMsg)
	tunnelReadyDone := make(chan struct{})
	if tunnelReady != nil {
		go func() {
			defer close(tunnelReadyDone)
			select {
			case url, ok := <-tunnelReady:
				if ok && url != "" {
					app.SendTunnelURL(url)
				}
			case <-ctx.Done():
			}
		}()
	} else {
		close(tunnelReadyDone)
	}
	var shutdownOnce sync.Once
	var shutdownErr error
	shutdownTUI := func() error {
		shutdownOnce.Do(func() {
			stopBridge()
			bridgeWaitCtx, cancelBridgeWait := context.WithTimeout(context.Background(), time.Second)
			bridgeErr := bridgeSession.Wait(bridgeWaitCtx)
			cancelBridgeWait()
			serverErr := shutdown()
			tunnelWaitCtx, cancelTunnelWait := context.WithTimeout(context.Background(), time.Second)
			defer cancelTunnelWait()
			var tunnelErr error
			select {
			case <-tunnelReadyDone:
			case <-tunnelWaitCtx.Done():
				tunnelErr = tunnelWaitCtx.Err()
			}
			shutdownErr = errors.Join(bridgeErr, serverErr, tunnelErr)
		})
		return shutdownErr
	}
	app.SetShutdownCallback(shutdownTUI)

	_, programErr := p.Run()
	result := app.ShutdownResult()
	if !result.Completed {
		cleanupErr := shutdownTUI()
		return errors.Join(programErr, cleanupErr)
	}
	if result.Err == nil {
		devStatusf(io, "%s Workbench closed. Dev server stopped.\n", devBullet(io))
	} else if result.Cause == tui.ShutdownRawInterrupt {
		devStatusf(io, "%s Workbench closed. Shutdown failed: %v\n", devBullet(io), result.Err)
	} else {
		devStatusf(io, "%s Workbench closed. Dev server cleanup incomplete.\n", devBullet(io))
	}
	if result.Cause == tui.ShutdownRawInterrupt {
		return domain.ExitError{Code: 130}
	}
	return errors.Join(programErr, result.Err)
}
