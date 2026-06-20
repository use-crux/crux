package server

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"

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
	// token gates the server whenever it is reachable beyond loopback (tunnel
	// or CRUX_HOST). Empty on a plain loopback server, where no auth is needed.
	token string
	// mainGated is true when the primary listener itself is exposed beyond
	// loopback (CRUX_HOST) and therefore requires the session token.
	mainGated bool
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
		if _, err := devtoolsSvc.ReindexProjectWithOptions(ctx, cwd, "", "", devtools.ProjectReindexOptions{
			Semantic: devtools.ProjectSemanticBackground,
		}); err != nil {
			slog.Warn("project index startup reindex failed", "error", err)
			return
		}
		startProjectIndexWatcher(ctx, cwd, devtoolsSvc)
	}()

	// Mint a session token and gate the primary listener only when it is
	// exposed beyond loopback. A normal loopback server stays auth-free, so
	// local DX is unchanged; a CRUX_HOST-exposed or tunneled server requires
	// the token (delivered invisibly via the auto-opened URL → cookie).
	host := listenHost()
	mainGated := !hostIsLoopback(host)
	token := generateSessionToken()
	mainHandler := handler
	if mainGated {
		mainHandler = requireSessionAuth(token, handler)
	}

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
		token:         token,
		mainGated:     mainGated,
		httpServer: &http.Server{
			Addr:    fmt.Sprintf("%s:%d", host, opts.Port),
			Handler: mainHandler,
		},
	}
}

// listenHost resolves the interface the local server binds to. It defaults to
// the loopback interface so the unauthenticated devtools API is not exposed to
// the local network. Setting CRUX_HOST (e.g. "0.0.0.0") opts into binding
// another interface for containerized or remote-dev setups that proxy the port;
// in that case the server is gated by the session token. The user-facing URL
// stays http://localhost:<port>, so normal local usage is unchanged.
func listenHost() string {
	host := strings.TrimSpace(os.Getenv("CRUX_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	return host
}

func hostIsLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func startProjectIndexWatcher(ctx context.Context, root string, devtoolsSvc *devtools.Service) {
	runner := projectwatch.NewRunner(func(runCtx context.Context, delta projectwatch.Delta) {
		if _, err := devtoolsSvc.ReindexProjectIncrementalWithOptions(runCtx, root, "", "", delta.Files, delta.DeletedFiles, devtools.ProjectReindexOptions{
			Semantic: devtools.ProjectSemanticBackground,
		}); err != nil {
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
		// The tunnel is a public surface, so it is always gated by the session
		// token regardless of how the local listener is bound. The token is
		// carried invisibly in the URL we hand back to be opened/shared.
		authedURL := withSessionToken(result.URL, d.token)
		d.TunnelURL = authedURL

		// Serve the same HTTP handler on the tunnel listener via a separate http.Server,
		// wrapped with session auth. Tunnel requests are handled by the exact
		// same Go handler — no TCP proxy, no forwarding, no ERR_NGROK_3004.
		tunnelServer := &http.Server{Handler: requireSessionAuth(d.token, d.handler)}
		go func() {
			slog.Info("serving tunnel traffic", "url", result.URL)
			if err := tunnelServer.Serve(result.Listener); err != nil && err != http.ErrServerClosed {
				slog.Error("tunnel serve error", "error", err)
			}
		}()

		if onReady != nil {
			onReady(authedURL)
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

// LocalURL returns the URL to open locally. When the primary listener is gated
// (CRUX_HOST exposure), the session token is embedded so the opened link
// authenticates on first load; otherwise it is the plain loopback URL.
func (d *DevServer) LocalURL() string {
	if d.mainGated {
		return withSessionToken(d.URL(), d.token)
	}
	return d.URL()
}

// LocalGated reports whether the primary listener requires the session token
// (i.e. it is exposed beyond loopback via CRUX_HOST).
func (d *DevServer) LocalGated() bool {
	return d.mainGated
}
