package server

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/lifecycle"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	evalserver "github.com/use-crux/crux/packages/local/internal/server/eval"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// DevServer wraps the Go HTTP server for the "crux dev" command.
type DevServer struct {
	ctx                   context.Context
	cancel                context.CancelFunc
	Store                 *store.Store
	Inspect               *inspect.Service
	Devtools              *devtools.Service
	Observability         *observability.Service
	EvalCatalog           *evalserver.Collector
	Port                  int
	TunnelURL             string
	IngestToken           string
	IngestTokenPath       string
	tunnel                bool
	handler               http.Handler
	httpServer            *http.Server
	webSocketHub          *WSHub
	closeRuntimeArtifacts func() error
	runtimeArtifacts      RuntimeArtifactGenerator
	enrichProjectRuntime  func(context.Context, string, store.IndexData) (store.IndexData, error)
	projectRoot           string
	startTunnel           func(context.Context, *slog.Logger) (*TunnelResult, error)
	logger                *slog.Logger
	shutdown              devServerShutdown
	workers               *devServerWorkers
	startup               *startup.Journal
	// token gates the server whenever it is reachable beyond loopback (tunnel
	// or CRUX_HOST). Empty on a plain loopback server, where no auth is needed.
	token string
	// mainGated is true when the primary listener itself is exposed beyond
	// loopback (CRUX_HOST) and therefore requires the session token.
	mainGated bool
}

// DevServerOptions configures the dev server.
type DevServerOptions struct {
	// Context is the parent of every server-owned worker and subscription. It
	// defaults to context.Background when omitted.
	Context context.Context
	Port    int
	Tunnel  bool
	// ServerVersion is passed explicitly from the Cobra root command.
	ServerVersion        string
	SourceResolverScript string
	ProjectIndexerScript string
	InspectDir           string
	ObservabilityDBPath  string
	IngestTokenPath      string
	RuntimeArtifacts     RuntimeArtifactGenerator
	ProjectIndexer       projectindex.ProjectIndexer
	StartupJournal       *startup.Journal
	SessionWorkers       *lifecycle.Group
	// Logger receives server and owned-worker lifecycle diagnostics. It defaults
	// to slog.Default when omitted and is scoped to this server instance.
	Logger *slog.Logger
	// Stderr receives diagnostic output written directly by owned subprocesses.
	Stderr io.Writer
	// Quiet suppresses slog output (for TUI mode where stdout/stderr is owned by Bubbletea).
	Quiet bool
}

// RuntimeArtifactGenerator refreshes Runtime Engine generated files from the
// native Project Index definitions for root.
type RuntimeArtifactGenerator func(ctx context.Context, root string, definitions []store.ProjectDefinition) error

const runtimeArtifactGenerationTimeout = 120 * time.Second

// NewDevServer creates a devtools server that listens on the given port.
func NewDevServer(opts DevServerOptions) *DevServer {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = os.Stderr
	}
	// Quiet is instance-scoped: it must never redirect unrelated process logs.
	if opts.Quiet {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
		stderr = io.Discard
	}

	s := store.NewStore()
	parentCtx := opts.Context
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	ctx, cancel := context.WithCancel(parentCtx)
	workers := opts.SessionWorkers
	if workers == nil {
		workers = &devServerWorkers{}
	}
	serverOpts := ServerOptions{
		SourceResolverScript: opts.SourceResolverScript,
		ProjectIndexerScript: opts.ProjectIndexerScript,
		InspectDir:           opts.InspectDir,
		ObservabilityDBPath:  opts.ObservabilityDBPath,
		ReviewDBPath:         ".crux/review.sqlite",
		ServerVersion:        opts.ServerVersion,
		Logger:               logger,
		Stderr:               stderr,
		workers:              workers,
	}
	var webSocketHub *WSHub
	serverOpts.webSocketHubCreated = func(hub *WSHub) {
		webSocketHub = hub
	}
	if cwd, err := os.Getwd(); err == nil {
		serverOpts.ProjectRoot = cwd
	} else {
		logger.Warn("project root detection failed", "error", err)
	}
	if serverOpts.ObservabilityDBPath == "" {
		serverOpts.ObservabilityDBPath = ".crux/observability.sqlite"
	}
	runtimeArtifacts := opts.RuntimeArtifacts
	var closeRuntimeArtifacts func() error
	if runtimeArtifacts == nil {
		runtimeArtifacts, closeRuntimeArtifacts = newRuntimeArtifactGeneratorForDev(opts.ProjectIndexerScript, logger, stderr)
	}
	runtimeArtifacts = privacyGuardedRuntimeArtifactGenerator(runtimeArtifacts)
	inspectDir := inspect.Dir(serverOpts.InspectDir)
	inspectSvc := inspect.NewService(s, inspectDir)
	devtoolsSvc := devtools.NewService(s, inspectSvc)
	if opts.ProjectIndexer != nil {
		devtoolsSvc.WithProjectIndexer(opts.ProjectIndexer)
	}
	runtimeArtifacts = discoveryIsolatedRuntimeArtifactGenerator(runtimeArtifacts, devtoolsSvc)
	evalCatalog := evalserver.NewFreshCollector(serverOpts.ProjectRoot, evalserver.CollectorDeps{
		FindNode: assets.FindNode, ExtractCoordinator: assets.ExtractEmbeddedEvalCoordinator,
		WaitForStartup: func(waitCtx context.Context) error {
			return waitForEvalDiscoveryStartup(waitCtx, opts.StartupJournal, devtoolsSvc.EvalDiscoveryIsolationRequired)
		},
		AcquireDiscovery: devtoolsSvc.AcquireEvalDiscoveryCapacity,
		Lifetime:         ctx,
		StartFlight:      workers.Go,
	})
	serverOpts.EvalCatalog = evalCatalog
	observabilitySvc, err := observability.OpenService(ctx, serverOpts.ObservabilityDBPath)
	if err != nil {
		logger.Error("observability service initialization failed", "error", err)
	}
	serverOpts.ObservabilityService = observabilitySvc
	handler := NewHTTPServerWithServicesContext(ctx, devtoolsSvc, serverOpts)
	// Gate only a non-loopback listener. Loopback remains auth-free; exposed
	// and tunneled servers require the session token carried by their URL.
	host := listenHost()
	mainGated := !hostIsLoopback(host)
	token := generateSessionToken(logger)
	ingestToken, ingestTokenPath, err := loadOrCreateIngestTokenWithLogger(opts.IngestTokenPath, logger)
	if err != nil {
		logger.Warn("persistent observability ingest token unavailable; using process-local token", "error", err)
		ingestToken = generateSessionToken(logger)
		ingestTokenPath = opts.IngestTokenPath
		if ingestTokenPath == "" {
			ingestTokenPath = defaultIngestTokenPath
		}
	}
	mainHandler := handler
	if mainGated {
		mainHandler = requireSessionAuth(token, ingestToken, handler)
	}

	devServer := &DevServer{
		ctx:             ctx,
		cancel:          cancel,
		Store:           s,
		Inspect:         inspectSvc,
		Devtools:        devtoolsSvc,
		Observability:   observabilitySvc,
		EvalCatalog:     evalCatalog,
		Port:            opts.Port,
		IngestToken:     ingestToken,
		IngestTokenPath: ingestTokenPath,
		tunnel:          opts.Tunnel,
		handler:         handler,
		token:           token,
		mainGated:       mainGated,
		httpServer: &http.Server{
			Addr:    fmt.Sprintf("%s:%d", host, opts.Port),
			Handler: mainHandler,
		},
		webSocketHub:          webSocketHub,
		closeRuntimeArtifacts: closeRuntimeArtifacts,
		runtimeArtifacts:      runtimeArtifacts,
		projectRoot:           serverOpts.ProjectRoot,
		startTunnel:           startNgrokTunnel,
		logger:                logger,
		workers:               workers,
		startup:               opts.StartupJournal,
	}
	return devServer
}

func waitForEvalDiscoveryStartup(ctx context.Context, journal *startup.Journal, isolationRequired func() bool) error {
	if journal == nil {
		return nil
	}
	if err := journal.WaitTask(ctx, "project-index"); err != nil {
		return err
	}
	if isolationRequired == nil || !isolationRequired() {
		return nil
	}
	return journal.WaitTask(ctx, "runtime-artifacts")
}

// Start begins listening. Returns immediately. Use Shutdown to stop.
func (d *DevServer) Start() error {
	ln, err := net.Listen("tcp", d.httpServer.Addr)
	if err != nil {
		return fmt.Errorf("listen on port %d: %w", d.Port, err)
	}

	if !d.workers.Go(func() {
		d.logger.Info("devtools server started", "port", d.Port)
		if err := d.httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			d.logger.Error("server error", "error", err)
		}
	}) {
		_ = ln.Close()
		return fmt.Errorf("start devtools server: server is shutting down")
	}
	if d.projectRoot != "" {
		if !d.workers.Go(d.runProjectIndexLifecycle) {
			_ = d.httpServer.Close()
			return fmt.Errorf("start devtools server warmup: server is shutting down")
		}
	}

	return nil
}

// URL returns the server's local URL.
func (d *DevServer) URL() string {
	return fmt.Sprintf("http://localhost:%d", d.Port)
}

// ProjectRoot returns the root used by project-scoped in-process readers.
func (d *DevServer) ProjectRoot() string { return d.projectRoot }

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
