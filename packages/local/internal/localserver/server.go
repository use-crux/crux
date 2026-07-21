package localserver

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/evalfs"
	"github.com/use-crux/crux/packages/local/internal/evalrunner"
	"github.com/use-crux/crux/packages/local/internal/evalwriter"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/review"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
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
	Logger         *slog.Logger
	Stderr         io.Writer
}

// Options contains the services and assets needed to mount Crux Local HTTP
// routes. It intentionally has no listener, port, or shutdown ownership.
type Options struct {
	Logger                   *slog.Logger
	Devtools                 *devtools.Service
	Inspect                  *inspect.Service
	Observability            *observability.Service
	Review                   *review.Service
	ReviewWriter             review.RepositoryWriter
	ReviewRepositoryWritable bool
	BaselineWriter           evalwriter.BaselineWriter
	EvalRunner               evalrunner.Runner
	EvalCatalog              endpoints.EvalCatalogReads
	RuntimeBridge            *runtimebridge.Service
	ResourceInspection       *resourceinspection.Service
	Hub                      Hub
	ProjectIndex             endpoints.DevtoolsReads
	ProjectRoot              string
	ConfigPath               string
	SourceResolver           SourceResolverOptions
	UI                       http.Handler
	OriginAllowed            func(*http.Request) bool
}

// New mounts the local runtime HTTP API and UI routes. Server lifecycle code
// supplies dependencies; this package owns route grouping and URL preservation.
func New(options Options) http.Handler {
	logger := options.Logger
	if logger == nil {
		logger = discardLogger
	}
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

	projectIndex := options.ProjectIndex
	if projectIndex == nil {
		projectIndex = options.Devtools
	}

	mux := http.NewServeMux()
	readmodel.Mount(mux, endpoints.Deps{
		Devtools:     options.Devtools,
		ProjectIndex: projectIndex,
		Catalog:      options.Devtools,
		Inspect:      options.Inspect,
		Eval:         evalfs.OpenProject(options.ProjectRoot),
		EvalCatalog:  options.EvalCatalog,
		Reviews:      options.Review,
	}, endpoints.Registry, logger)

	registerInspectRoutes(mux, options.Inspect)
	if options.Hub != nil {
		mux.HandleFunc("/ws/ui", options.Hub.HandleUpgrade)
	}
	registerRuntimeBridgeRoutes(mux, runtimeBridge, originAllowed)
	registerResourceRoutes(mux, resourceInspection)
	registerObservabilityRoutesWithReview(mux, options.Observability, inspectEvents(options.Inspect), options.Devtools, options.Review)
	registerFeedbackRoutes(mux, options.Review, options.Observability)
	registerReviewRoutes(mux, options.Review, options.ReviewWriter, options.ReviewRepositoryWritable)
	registerEvalRoutes(mux, options.BaselineWriter, options.EvalRunner)
	registerIndexRoutes(mux, options.Devtools)
	registerRuntimeRoutes(mux, options.Devtools, options.ProjectRoot)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	sourceResolver := options.SourceResolver
	if sourceResolver.Logger == nil {
		sourceResolver.Logger = logger
	}
	registerSourceRoutes(mux, sourceResolver, options.ProjectRoot)

	if options.UI != nil {
		mux.Handle("/", options.UI)
	}

	return requestLoggerMiddleware(corsMiddleware(mux, originAllowed), logger)
}

func inspectEvents(service *inspect.Service) *inspect.EventBus {
	if service == nil {
		return nil
	}
	return service.Events()
}
