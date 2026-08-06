package commands

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/evalfs"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/tui"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

func printIngestTokenHint(io *output.IO, token, tokenPath string) {
	if token == "" || tokenPath == "" {
		return
	}
	devStatusf(io, "%s Remote observability ingest: %s · read with %s\n",
		devBullet(io), devStrong(io, "ingest token "+tokenPath), devText(io, "cat "+tokenPath))
}

func newTUIApp(ctx context.Context, serverURL string, client tui.DataClient, startup *startupTracker) *tui.App {
	return tui.NewApp(ctx, serverURL, client, startup.Mode(), startup.Enabled())
}

func newTUIProgram(io *output.IO, app *tui.App) *tea.Program {
	var program *tea.Program
	filter := tui.NewInputCoalescer(func(msg tea.Msg) { program.Send(msg) })
	program = tea.NewProgram(app,
		tea.WithInput(io.In),
		tea.WithOutput(tuiOutput(io.Out)),
		tea.WithoutSignalHandler(),
		tea.WithFilter(filter.Filter),
	)
	return program
}

// Bubble Tea probes synchronized-output and Unicode-width modes on startup.
// Some WSL terminal stacks answer after the input reader has stopped, leaving
// the reply for the shell to echo. These optimizations are optional, so keep
// the terminal protocol deterministic by suppressing only those two probes.
type tuiOutputWithoutDelayedCapabilityReplies struct {
	io.Writer
}

type tuiTerminalOutput struct {
	tuiOutputWithoutDelayedCapabilityReplies
	file interface {
		io.ReadWriteCloser
		Fd() uintptr
	}
}

func (w tuiTerminalOutput) Read(p []byte) (int, error) { return w.file.Read(p) }
func (w tuiTerminalOutput) Close() error               { return w.file.Close() }
func (w tuiTerminalOutput) Fd() uintptr                { return w.file.Fd() }

func tuiOutput(writer io.Writer) io.Writer {
	filtered := tuiOutputWithoutDelayedCapabilityReplies{Writer: writer}
	if terminal, ok := writer.(interface {
		io.ReadWriteCloser
		Fd() uintptr
	}); ok {
		return tuiTerminalOutput{tuiOutputWithoutDelayedCapabilityReplies: filtered, file: terminal}
	}
	return filtered
}

func (w tuiOutputWithoutDelayedCapabilityReplies) Write(p []byte) (int, error) {
	filtered := bytes.ReplaceAll(p, []byte("\x1b[?2026$p"), nil)
	filtered = bytes.ReplaceAll(filtered, []byte("\x1b[?2027$p"), nil)
	written, err := w.Writer.Write(filtered)
	if err != nil {
		return 0, err
	}
	if written != len(filtered) {
		return 0, io.ErrShortWrite
	}
	return len(p), nil
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

	c := devtools.NewDirectClientFromService(devSrv.Devtools).
		WithObservability(devSrv.Observability).
		WithEvalReads(
			evalfs.OpenProject(devSrv.ProjectRoot()),
			devSrv.EvalCatalog,
		)
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
	startupUpdatesDone := make(chan struct{})
	if startup != nil && startup.journal != nil {
		snapshot, updates := startup.journal.SnapshotAndSubscribe(bridgeCtx)
		app.SendStartupSnapshot(snapshot)
		go func() {
			defer close(startupUpdatesDone)
			for snapshot := range updates {
				app.SendStartupSnapshot(snapshot)
			}
		}()
	} else {
		close(startupUpdatesDone)
	}
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
			var startupUpdatesErr error
			select {
			case <-startupUpdatesDone:
			case <-bridgeWaitCtx.Done():
				startupUpdatesErr = bridgeWaitCtx.Err()
			}
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
			shutdownErr = errors.Join(bridgeErr, startupUpdatesErr, serverErr, tunnelErr)
		})
		return shutdownErr
	}
	app.SetShutdownCallback(shutdownTUI)

	_, programErr := p.Run()
	result := app.FinishShutdown()
	if result.Err == nil {
		devStatusf(io, "%s Workbench closed. Dev server stopped.\n", devBullet(io))
	} else if result.Cause == tui.ShutdownRawInterrupt {
		devStatusf(io, "%s Workbench closed. Shutdown failed: %v\n", devBullet(io), result.Err)
	} else {
		devStatusf(io, "%s Workbench closed. Dev server cleanup incomplete.\n", devBullet(io))
	}
	return errors.Join(programErr, result.Err)
}
