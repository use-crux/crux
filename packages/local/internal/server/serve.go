package server

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectwatch"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// DevServer wraps the Go HTTP server for the "crux dev" command.
type DevServer struct {
	ctx           context.Context
	cancel        context.CancelFunc
	Store         *store.Store
	Quality       *quality.Service
	Devtools      *devtools.Service
	Observability *observability.Service
	Port          int
	TunnelURL     string
	tunnel        bool
	handler       http.Handler
	httpServer    *http.Server
}

// DevServerOptions configures the dev server.
type DevServerOptions struct {
	Port                 int
	Tunnel               bool
	SourceResolverScript string
	ProjectIndexerScript string
	QualityDir           string
	ObservabilityDBPath  string
	// Quiet suppresses slog output (for TUI mode where stdout/stderr is owned by Bubbletea).
	Quiet bool
}

// NewDevServer creates a devtools server that listens on the given port.
func NewDevServer(opts DevServerOptions) *DevServer {
	// In quiet mode, discard all slog output to avoid corrupting the TUI.
	if opts.Quiet {
		slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	}

	s := store.NewStore()
	ctx, cancel := context.WithCancel(context.Background())
	serverOpts := ServerOptions{
		SourceResolverScript: opts.SourceResolverScript,
		ProjectIndexerScript: opts.ProjectIndexerScript,
		QualityDir:           opts.QualityDir,
		ObservabilityDBPath:  opts.ObservabilityDBPath,
	}
	if cwd, err := os.Getwd(); err == nil {
		serverOpts.ProjectRoot = cwd
	} else {
		slog.Warn("project root detection failed", "error", err)
	}
	if serverOpts.SourceResolverScript == "" {
		if script, err := ExtractSourceResolver(); err == nil {
			serverOpts.SourceResolverScript = script
		} else {
			slog.Warn("source resolver unavailable", "error", err)
		}
	}
	if serverOpts.ProjectIndexerScript == "" {
		if script, err := ExtractProjectIndexer(); err == nil {
			serverOpts.ProjectIndexerScript = script
		} else {
			slog.Warn("project index indexer unavailable", "error", err)
		}
	}
	if serverOpts.ObservabilityDBPath == "" {
		serverOpts.ObservabilityDBPath = ".crux/observability.sqlite"
	}
	qualitySvc := quality.NewService(s, quality.Dir(serverOpts.QualityDir))
	devtoolsSvc := devtools.NewService(s, qualitySvc)
	observabilitySvc, err := observability.OpenService(ctx, serverOpts.ObservabilityDBPath)
	if err != nil {
		slog.Error("observability service initialization failed", "error", err)
	}
	serverOpts.ObservabilityService = observabilitySvc
	handler := NewHTTPServerWithServicesContext(ctx, devtoolsSvc, serverOpts)
	go func() {
		cwd, err := os.Getwd()
		if err != nil {
			slog.Warn("project index startup reindex skipped", "error", err)
			return
		}
		if _, err := devtoolsSvc.ReindexProject(ctx, cwd, "", ""); err != nil {
			slog.Warn("project index startup reindex failed", "error", err)
			return
		}
		startProjectIndexWatcher(ctx, cwd, devtoolsSvc)
	}()

	return &DevServer{
		ctx:           ctx,
		cancel:        cancel,
		Store:         s,
		Quality:       qualitySvc,
		Devtools:      devtoolsSvc,
		Observability: observabilitySvc,
		Port:          opts.Port,
		tunnel:        opts.Tunnel,
		handler:       handler,
		httpServer: &http.Server{
			Addr:    fmt.Sprintf(":%d", opts.Port),
			Handler: handler,
		},
	}
}

func startProjectIndexWatcher(ctx context.Context, root string, devtoolsSvc *devtools.Service) {
	runner := projectwatch.NewRunner(func(runCtx context.Context, delta projectwatch.Delta) {
		if _, err := devtoolsSvc.ReindexProjectIncremental(runCtx, root, "", "", delta.Files, delta.DeletedFiles); err != nil {
			slog.Warn(
				"project index incremental reindex failed",
				"error", err,
				"files", len(delta.Files),
				"deletedFiles", len(delta.DeletedFiles),
			)
		}
	})
	watcher, err := projectwatch.New(projectwatch.Options{
		Root: root,
		OnDelta: func(delta projectwatch.Delta) {
			runner.Enqueue(ctx, delta)
		},
	})
	if err != nil {
		slog.Warn("project index watcher unavailable", "error", err)
		return
	}
	go func() {
		slog.Info("project index watcher started", "root", root)
		if err := watcher.Run(ctx); err != nil {
			slog.Warn("project index watcher stopped", "error", err)
		}
	}()
}

// Start begins listening. Returns immediately. Use Shutdown to stop.
func (d *DevServer) Start() error {
	ln, err := net.Listen("tcp", d.httpServer.Addr)
	if err != nil {
		return fmt.Errorf("listen on port %d: %w", d.Port, err)
	}

	go func() {
		slog.Info("devtools server started", "port", d.Port)
		if err := d.httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
		}
	}()

	return nil
}

// StartTunnel starts the ngrok tunnel asynchronously.
// The tunnel listener serves the same HTTP handler as the local server —
// no TCP forwarding needed. Calls onReady with the tunnel URL when connected.
// Returns immediately. Safe to call even if Tunnel is false (no-op).
func (d *DevServer) StartTunnel(ctx context.Context, onReady func(url string)) {
	if !d.tunnel {
		return
	}

	go func() {
		result, err := StartNgrokTunnel(ctx)
		if err != nil {
			slog.Warn("tunnel failed to start", "error", err)
			return
		}
		d.TunnelURL = result.URL

		// Serve the same HTTP handler on the tunnel listener via a separate http.Server.
		// Tunnel requests are handled by the exact same Go handler —
		// no TCP proxy, no forwarding, no ERR_NGROK_3004.
		tunnelServer := &http.Server{Handler: d.handler}
		go func() {
			slog.Info("serving tunnel traffic", "url", result.URL)
			if err := tunnelServer.Serve(result.Listener); err != nil && err != http.ErrServerClosed {
				slog.Error("tunnel serve error", "error", err)
			}
		}()

		if onReady != nil {
			onReady(result.URL)
		}
	}()
}

// Shutdown gracefully stops the server.
func (d *DevServer) Shutdown(ctx context.Context) error {
	slog.Info("shutting down devtools server")
	d.cancel()
	if d.Devtools != nil {
		d.Devtools.Shutdown()
	}
	if d.Observability != nil {
		_ = d.Observability.Close()
	}
	return d.httpServer.Shutdown(ctx)
}

// URL returns the server's local URL.
func (d *DevServer) URL() string {
	return fmt.Sprintf("http://localhost:%d", d.Port)
}
