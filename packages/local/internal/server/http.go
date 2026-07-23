package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/evalrunner"
	"github.com/use-crux/crux/packages/local/internal/evalwriter"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/localserver"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex/manifeststore"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/review"
	"github.com/use-crux/crux/packages/local/internal/reviewwriter"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/server/bridge"
	evalserver "github.com/use-crux/crux/packages/local/internal/server/eval"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ServerOptions configures the HTTP server.
type ServerOptions struct {
	// SourceResolverScript overrides the embedded source-resolver.mjs path.
	// If empty, the embedded worker is extracted lazily on first use.
	SourceResolverScript string
	// ProjectIndexerScript overrides the embedded project-indexer.mjs path.
	// If empty, the embedded worker is extracted lazily on first use.
	ProjectIndexerScript string
	// InspectDir is the local Eval and insight directory.
	// Defaults to .crux/evals relative to the server working directory.
	InspectDir string
	// ObservabilityDBPath is the local SQLite path for canonical graph records.
	// Defaults to an in-memory database for direct handler construction.
	ObservabilityDBPath  string
	ObservabilityService *observability.Service
	ReviewDBPath         string
	ReviewService        *review.Service
	ReviewWriter         review.RepositoryWriter
	RuntimeBridge        *runtimebridge.Service
	ProjectRoot          string
	ServerVersion        string
	ConfigPath           string
	// Logger receives handler and owned-service diagnostics. It defaults to
	// slog.Default when omitted and remains scoped to this server instance.
	Logger *slog.Logger
	// Stderr receives diagnostic output written directly by owned subprocesses.
	Stderr io.Writer
	// webSocketHubCreated exposes the composed hub to DevServer so its
	// lifecycle coordinator can wait for hijacked connections during shutdown.
	webSocketHubCreated func(*WSHub)
	workers             *devServerWorkers
}

// NewHTTPServer creates an HTTP handler that serves the devtools REST API.
func NewHTTPServer(s *store.Store, opts ...ServerOptions) http.Handler {
	var opt ServerOptions
	if len(opts) > 0 {
		opt = opts[0]
	}
	inspectSvc := inspect.NewService(s, inspect.Dir(opt.InspectDir))
	return NewHTTPServerWithServices(devtools.NewService(s, inspectSvc), opt)
}

// NewHTTPServerWithInspect creates an HTTP handler backed by an explicit Inspect service.
func NewHTTPServerWithInspect(s *store.Store, inspectSvc *inspect.Service, opt ServerOptions) http.Handler {
	if inspectSvc == nil {
		inspectSvc = inspect.NewService(s, inspect.Dir(opt.InspectDir))
	}
	return NewHTTPServerWithServices(devtools.NewService(s, inspectSvc), opt)
}

// NewHTTPServerWithServices creates an HTTP handler backed by explicit services.
func NewHTTPServerWithServices(devSvc *devtools.Service, opt ServerOptions) http.Handler {
	return NewHTTPServerWithServicesContext(context.Background(), devSvc, opt)
}

// NewHTTPServerWithServicesContext composes local runtime services and returns
// the HTTP route graph. Listener lifecycle remains owned by DevServer.
func NewHTTPServerWithServicesContext(ctx context.Context, devSvc *devtools.Service, opt ServerOptions) http.Handler {
	logger := opt.Logger
	if logger == nil {
		logger = slog.Default()
	}
	inspectSvc := devSvc.Inspect()
	privacyProvider := privacy.Generated(opt.ProjectRoot)
	if !devSvc.HasProjectIndexer() {
		workerOptions := []workerproc.Option{workerproc.WithLogger(logger)}
		if opt.Stderr != nil {
			workerOptions = append(workerOptions, workerproc.WithStderr(opt.Stderr))
		}
		projectIndexer := assets.NewEmbeddedProjectIndexer(opt.ProjectIndexerScript, workerOptions...)
		devSvc.WithProjectIndexer(projectIndexer)
		opt.workers.Go(func() {
			<-ctx.Done()
			if err := projectIndexer.Close(); err != nil {
				logger.Warn("project index worker close failed", "error", err)
			}
		})
	}

	observabilitySvc := opt.ObservabilityService
	if observabilitySvc == nil {
		observabilityPath := opt.ObservabilityDBPath
		if observabilityPath == "" {
			observabilityPath = ":memory:"
		}
		var err error
		observabilitySvc, err = observability.OpenService(ctx, observabilityPath)
		if err != nil {
			logger.Error("observability service initialization failed", "error", err)
		}
	}
	if observabilitySvc != nil && opt.ObservabilityService == nil {
		opt.workers.Go(func() {
			<-ctx.Done()
			if err := observabilitySvc.Close(); err != nil {
				logger.Warn("observability service close failed", "error", err)
			}
		})
	}
	if opt.ProjectRoot != "" {
		manifests := manifeststore.New(opt.ProjectRoot)
		devSvc.WithManifestStore(manifests)
		if observabilitySvc != nil {
			observabilitySvc.WithManifestStore(manifests)
		}
	}
	if observabilitySvc != nil {
		devSvc.WithObservability(observabilitySvc)
	}
	reviewSvc := opt.ReviewService
	if reviewSvc == nil {
		reviewPath := opt.ReviewDBPath
		if reviewPath == "" {
			reviewPath = ":memory:"
		}
		var err error
		reviewSvc, err = review.OpenService(ctx, reviewPath, review.WithPrivacyProvider(privacyProvider))
		if err != nil {
			logger.Error("review service initialization failed", "error", err)
		}
	}
	if reviewSvc != nil && opt.ReviewService == nil {
		opt.workers.Go(func() {
			<-ctx.Done()
			if err := reviewSvc.Close(); err != nil {
				logger.Warn("review service close failed", "error", err)
			}
		})
	}

	runtimeBridge := opt.RuntimeBridge
	if runtimeBridge == nil {
		runtimeBridge = runtimebridge.NewService(nil, runtimebridge.WithLogger(logger))
	}
	resourceInspection := resourceinspection.New(runtimeBridge)
	devSvc.WithResourceInspection(resourceInspection)

	wsHub := NewWSHub(ctx, devSvc, inspectSvc.Events(), observabilityEvents(observabilitySvc), runtimeBridge, logger, IndexSnapshotOptions{
		ProjectRoot:   opt.ProjectRoot,
		ServerVersion: opt.ServerVersion,
	})
	if opt.webSocketHubCreated != nil {
		opt.webSocketHubCreated(wsHub)
	}
	opt.workers.Go(func() { bridge.DiscoverPeers(ctx, runtimeBridge, opt.ProjectRoot) })

	reviewCaseWriter, reviewRepositoryWritable := reviewWriter(opt, privacyProvider)
	return localserver.New(localserver.Options{
		Logger:                   logger,
		Devtools:                 devSvc,
		Inspect:                  inspectSvc,
		Observability:            observabilitySvc,
		Review:                   reviewSvc,
		ReviewWriter:             reviewCaseWriter,
		ReviewRepositoryWritable: reviewRepositoryWritable,
		BaselineWriter:           evalwriter.Writer{ProjectRoot: opt.ProjectRoot},
		EvalRunner:               evalrunner.Coordinator{ProjectRoot: opt.ProjectRoot},
		EvalCatalog: evalserver.NewCollector(opt.ProjectRoot, evalserver.CollectorDeps{
			FindNode: assets.FindNode, ExtractCoordinator: assets.ExtractEmbeddedEvalCoordinator,
		}),
		RuntimeBridge:      runtimeBridge,
		ResourceInspection: resourceInspection,
		Hub:                wsHub,
		ProjectIndex:       wsHub,
		Completion:         wsHub,
		ProjectRoot:        opt.ProjectRoot,
		ConfigPath:         opt.ConfigPath,
		SourceResolver: localserver.SourceResolverOptions{
			ScriptPath:     opt.SourceResolverScript,
			EmbeddedScript: assets.EmbeddedSourceResolverScript(),
			Logger:         logger,
			Stderr:         opt.Stderr,
		},
		UI:            assets.EmbeddedUIHandler(logger),
		OriginAllowed: originAllowed,
	})
}

func reviewWriter(opt ServerOptions, privacyProvider privacy.Provider) (review.RepositoryWriter, bool) {
	if opt.ReviewWriter != nil {
		return opt.ReviewWriter, true
	}
	// The project-local Core worker is also the canonical projector. When the
	// server has no repository root it still returns pending-sync artifacts and
	// must not claim that a file was written.
	return reviewwriter.Writer{ProjectRoot: opt.ProjectRoot, Privacy: privacyProvider}, opt.ProjectRoot != ""
}

func observabilityEvents(service *observability.Service) *observability.EventBus {
	if service == nil {
		return nil
	}
	return service.Events()
}

func writeJSON(logger *slog.Logger, w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		logger.Error("JSON encode error", "error", err)
	}
}

// originAllowed reports whether a browser request's Origin is permitted to
// interact with the local server. Requests with no Origin header (CLI tools,
// same-origin navigations, non-browser runtime peers) are always allowed.
// Otherwise the Origin must be a loopback address or match the request Host.
func originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	return isLoopbackHost(u.Hostname())
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}
