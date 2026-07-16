package localserver

import (
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/evalfs"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	qualityserver "github.com/use-crux/crux/packages/local/internal/server/quality"
)

// Hub is the route-facing websocket surface used by localserver. The concrete
// lifecycle and fan-out implementation stays in the server package.
type Hub interface {
	BroadcastJSON(v any)
	HandleUpgrade(http.ResponseWriter, *http.Request)
}

// SourceResolverOptions configures source-resolution routes without making
// localserver own embedded worker bytes.
type SourceResolverOptions struct {
	ScriptPath     string
	EmbeddedScript []byte
}

// Options contains the services and assets needed to mount Crux Local HTTP
// routes. It intentionally has no listener, port, or shutdown ownership.
type Options struct {
	Devtools           *devtools.Service
	Quality            *quality.Service
	Observability      *observability.Service
	RuntimeBridge      *runtimebridge.Service
	ResourceInspection *resourceinspection.Service
	Hub                Hub
	ProjectRoot        string
	ConfigPath         string
	QualityRunner      qualityserver.RunnerDeps
	SourceResolver     SourceResolverOptions
	UI                 http.Handler
	OriginAllowed      func(*http.Request) bool
}

// New mounts the local runtime HTTP API and UI routes. Server lifecycle code
// supplies dependencies; this package owns route grouping and URL preservation.
func New(options Options) http.Handler {
	runtimeBridge := options.RuntimeBridge
	if runtimeBridge == nil {
		runtimeBridge = runtimebridge.NewService(nil)
	}
	resourceInspection := options.ResourceInspection
	if resourceInspection == nil {
		resourceInspection = resourceinspection.New(runtimeBridge)
	}
	originAllowed := options.OriginAllowed
	if originAllowed == nil {
		originAllowed = allowSameOriginOrLoopback
	}

	mux := http.NewServeMux()
	readmodel.Mount(mux, endpoints.Deps{
		Devtools: options.Devtools,
		Catalog:  options.Devtools,
		Quality:  options.Quality,
		Eval:     evalfs.OpenProject(options.ProjectRoot),
		Evaluations: qualityserver.NewEvaluationCollector(
			options.ProjectRoot,
			options.ConfigPath,
			options.QualityRunner,
		),
	}, endpoints.Registry)

	registerQualityRoutes(mux, options.Quality, options.Hub, options.ProjectRoot, options.ConfigPath, options.QualityRunner)
	if options.Hub != nil {
		mux.HandleFunc("/ws/ui", options.Hub.HandleUpgrade)
	}
	registerRuntimeBridgeRoutes(mux, runtimeBridge, originAllowed)
	registerResourceRoutes(mux, resourceInspection)
	registerObservabilityRoutesWithCatalog(mux, options.Observability, qualityEvents(options.Quality), options.Devtools)
	registerIndexRoutes(mux, options.Devtools)
	registerRuntimeRoutes(mux, options.Devtools, options.ProjectRoot)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	registerSourceRoutes(mux, options.SourceResolver, options.ProjectRoot)

	if options.UI != nil {
		mux.Handle("/", options.UI)
	}

	return corsMiddleware(mux, originAllowed)
}

func qualityEvents(service *quality.Service) *quality.EventBus {
	if service == nil {
		return nil
	}
	return service.Events()
}
