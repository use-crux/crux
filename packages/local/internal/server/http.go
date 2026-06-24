package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/localserver"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/server/bridge"
	qualityserver "github.com/use-crux/crux/packages/local/internal/server/quality"
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
	// QualityDir is the local quality workbench directory.
	// Defaults to .crux/quality relative to the server working directory.
	QualityDir string
	// ObservabilityDBPath is the local SQLite path for canonical graph records.
	// Defaults to an in-memory database for direct handler construction.
	ObservabilityDBPath  string
	ObservabilityService *observability.Service
	RuntimeBridge        *runtimebridge.Service
	ProjectRoot          string
	ConfigPath           string
}

// NewHTTPServer creates an HTTP handler that serves the devtools REST API.
func NewHTTPServer(s *store.Store, opts ...ServerOptions) http.Handler {
	var opt ServerOptions
	if len(opts) > 0 {
		opt = opts[0]
	}
	qualitySvc := quality.NewService(s, quality.Dir(opt.QualityDir))
	return NewHTTPServerWithServices(devtools.NewService(s, qualitySvc), opt)
}

// NewHTTPServerWithQuality creates an HTTP handler backed by an explicit quality service.
func NewHTTPServerWithQuality(s *store.Store, qualitySvc *quality.Service, opt ServerOptions) http.Handler {
	if qualitySvc == nil {
		qualitySvc = quality.NewService(s, quality.Dir(opt.QualityDir))
	}
	return NewHTTPServerWithServices(devtools.NewService(s, qualitySvc), opt)
}

// NewHTTPServerWithServices creates an HTTP handler backed by explicit services.
func NewHTTPServerWithServices(devSvc *devtools.Service, opt ServerOptions) http.Handler {
	return NewHTTPServerWithServicesContext(context.Background(), devSvc, opt)
}

// NewHTTPServerWithServicesContext composes local runtime services and returns
// the HTTP route graph. Listener lifecycle remains owned by DevServer.
func NewHTTPServerWithServicesContext(ctx context.Context, devSvc *devtools.Service, opt ServerOptions) http.Handler {
	qualitySvc := devSvc.Quality()
	if !devSvc.HasProjectIndexer() {
		projectIndexer := NewEmbeddedProjectIndexer(opt.ProjectIndexerScript)
		devSvc.WithProjectIndexer(projectIndexer)
		go func() {
			<-ctx.Done()
			if err := projectIndexer.Close(); err != nil {
				slog.Warn("project index worker close failed", "error", err)
			}
		}()
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
			slog.Error("observability service initialization failed", "error", err)
		}
	}
	if observabilitySvc != nil && opt.ObservabilityService == nil {
		go func() {
			<-ctx.Done()
			if err := observabilitySvc.Close(); err != nil {
				slog.Warn("observability service close failed", "error", err)
			}
		}()
	}
	if observabilitySvc != nil {
		devSvc.WithObservability(observabilitySvc)
	}

	runtimeBridge := opt.RuntimeBridge
	if runtimeBridge == nil {
		runtimeBridge = runtimebridge.NewService(nil)
	}
	resourceInspection := resourceinspection.New(runtimeBridge)
	devSvc.WithResourceInspection(resourceInspection)

	wsHub := NewWSHub(ctx, devSvc, qualitySvc.Events(), observabilityEvents(observabilitySvc), runtimeBridge)
	go bridge.DiscoverPeers(ctx, runtimeBridge, opt.ProjectRoot)

	return localserver.New(localserver.Options{
		Devtools:           devSvc,
		Quality:            qualitySvc,
		Observability:      observabilitySvc,
		RuntimeBridge:      runtimeBridge,
		ResourceInspection: resourceInspection,
		Hub:                wsHub,
		ProjectRoot:        opt.ProjectRoot,
		ConfigPath:         opt.ConfigPath,
		QualityRunner: qualityserver.RunnerDeps{
			FindNode:      FindNode,
			ExtractRunner: ExtractQualityRunner,
		},
		SourceResolver: localserver.SourceResolverOptions{
			ScriptPath:     opt.SourceResolverScript,
			EmbeddedScript: embeddedSourceResolver,
		},
		UI:            UIHandler(),
		OriginAllowed: originAllowed,
	})
}

func observabilityEvents(service *observability.Service) *observability.EventBus {
	if service == nil {
		return nil
	}
	return service.Events()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("JSON encode error", "error", err)
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
