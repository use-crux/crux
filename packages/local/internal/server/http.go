package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/server/bridge"
	qualityserver "github.com/use-crux/crux/packages/local/internal/server/quality"
	"github.com/use-crux/crux/packages/local/internal/server/resources"
	"github.com/use-crux/crux/packages/local/internal/server/source"
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
	observabilityPath := opt.ObservabilityDBPath
	if observabilityPath == "" {
		observabilityPath = ":memory:"
	}
	observabilitySvc := opt.ObservabilityService
	if observabilitySvc == nil {
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
	var observabilityEvents *observability.EventBus
	if observabilitySvc != nil {
		observabilityEvents = observabilitySvc.Events()
		devSvc.WithObservability(observabilitySvc)
	}
	runtimeBridge := opt.RuntimeBridge
	if runtimeBridge == nil {
		runtimeBridge = runtimebridge.NewService(nil)
	}
	resourceInspection := resourceinspection.New(runtimeBridge)
	devSvc.WithResourceInspection(resourceInspection)
	wsHub := NewWSHub(ctx, devSvc, qualitySvc.Events(), observabilityEvents, runtimeBridge)
	go bridge.DiscoverPeers(ctx, runtimeBridge, opt.ProjectRoot)

	mux := http.NewServeMux()
	qualityRunner := qualityserver.RunnerDeps{
		FindNode:      FindNode,
		ExtractRunner: ExtractQualityRunner,
	}
	readmodel.Mount(mux, endpoints.Deps{
		Devtools:    devSvc,
		Quality:     qualitySvc,
		Evaluations: qualityserver.NewEvaluationCollector(opt.ProjectRoot, opt.ConfigPath, qualityRunner),
	}, endpoints.Registry)

	qualityserver.RegisterRunEvents(mux, wsHub, qualitySvc.Events())
	qualityserver.RegisterPromote(mux, opt.ProjectRoot, opt.ConfigPath, qualityRunner, qualitySvc.Events())

	// WebSocket upgrade
	mux.HandleFunc("/ws/ui", wsHub.HandleUpgrade)
	mux.HandleFunc("/ws/runtime", bridge.UpgradeHandler(runtimeBridge, originAllowed))
	bridge.RegisterRoutes(mux, runtimeBridge)
	resources.RegisterRoutes(mux, resourceInspection)

	registerObservabilityHTTP(mux, observabilitySvc, qualitySvc.Events())

	// Index
	mux.HandleFunc("POST /api/index/snapshot", func(w http.ResponseWriter, r *http.Request) {
		var snapshot store.IndexData
		if err := json.NewDecoder(r.Body).Decode(&snapshot); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if snapshot.SchemaVersion != 0 && snapshot.SchemaVersion != 1 {
			http.Error(w, "unsupported index schemaVersion", http.StatusBadRequest)
			return
		}
		devSvc.RegisterIndexSnapshot(r.Context(), snapshot)
		w.WriteHeader(http.StatusNoContent)
	})
	indexReindexHandler := func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Root         string   `json:"root,omitempty"`
			ConfigPath   string   `json:"configPath,omitempty"`
			ProjectName  string   `json:"projectName,omitempty"`
			Files        []string `json:"files,omitempty"`
			DeletedFiles []string `json:"deletedFiles,omitempty"`
			RuntimeRich  bool     `json:"runtimeRich,omitempty"`
		}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&req)
		}
		root := req.Root
		if root == "" {
			cwd, err := os.Getwd()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			root = cwd
		}
		var index store.IndexData
		var err error
		if req.RuntimeRich && (len(req.Files) > 0 || len(req.DeletedFiles) > 0) {
			http.Error(w, "runtimeRich reindex requires a full reindex request", http.StatusBadRequest)
			return
		}
		if req.RuntimeRich {
			index, err = devSvc.ReindexProjectRuntimeRich(r.Context(), root, req.ConfigPath, req.ProjectName)
		} else if len(req.Files) > 0 || len(req.DeletedFiles) > 0 {
			index, err = devSvc.ReindexProjectIncremental(r.Context(), root, req.ConfigPath, req.ProjectName, req.Files, req.DeletedFiles)
		} else {
			index, err = devSvc.ReindexProject(r.Context(), root, req.ConfigPath, req.ProjectName)
		}
		if err != nil {
			slog.Error("project index reindex failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, index)
	}
	mux.HandleFunc("POST /api/project/index/reindex", indexReindexHandler)
	mux.HandleFunc("POST /api/index/reindex", indexReindexHandler)
	mux.HandleFunc("DELETE /api/quality/runs", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			TraceIDs []string `json:"traceIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if len(req.TraceIDs) == 0 {
			http.Error(w, "traceIds is required", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.DeleteRuns(r.Context(), req.TraceIDs)
		if err != nil {
			slog.Warn("quality runs delete failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, record)
	})
	mux.HandleFunc("DELETE /api/quality/runs/{traceId}", func(w http.ResponseWriter, r *http.Request) {
		traceID := r.PathValue("traceId")
		record, err := qualitySvc.DeleteRuns(r.Context(), []string{traceID})
		if err != nil {
			slog.Warn("quality run delete failed", "error", err, "traceId", traceID)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(record.DeletedTraceIDs) == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, record)
	})
	mux.HandleFunc("POST /api/quality/insights/silences", func(w http.ResponseWriter, r *http.Request) {
		var req quality.InsightSilenceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.CreateInsightSilence(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(record); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})
	mux.HandleFunc("DELETE /api/quality/insights/silences/{silenceId}", func(w http.ResponseWriter, r *http.Request) {
		record, err := qualitySvc.DeleteInsightSilence(r.Context(), r.PathValue("silenceId"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, record)
	})
	mux.HandleFunc("POST /api/quality/insights/{insightId}/status", func(w http.ResponseWriter, r *http.Request) {
		var req quality.InsightStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.SetInsightStatus(r.Context(), r.PathValue("insightId"), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(record); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})
	mux.HandleFunc("POST /api/quality/feedback/{feedbackId}/status", func(w http.ResponseWriter, r *http.Request) {
		var req quality.FeedbackAnnotationPostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		req.FeedbackID = r.PathValue("feedbackId")
		record, err := qualitySvc.CreateFeedbackAnnotation(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(record); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})
	mux.HandleFunc("POST /api/quality/feedback/annotations", func(w http.ResponseWriter, r *http.Request) {
		var req quality.FeedbackAnnotationPostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.CreateFeedbackAnnotation(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(record); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})
	mux.HandleFunc("POST /api/quality/feedback", func(w http.ResponseWriter, r *http.Request) {
		var req quality.FeedbackPostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.CreateFeedback(r.Context(), req)
		if err != nil {
			slog.Warn("quality feedback write failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(record); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	source.RegisterRoutes(mux, opt.SourceResolverScript, embeddedSourceResolver)

	// Static UI serving — must be registered last (catch-all for non-API paths).
	if uiHandler := UIHandler(); uiHandler != nil {
		mux.Handle("/", uiHandler)
	}

	// CORS middleware wrapper
	return corsMiddleware(mux)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("JSON encode error", "error", err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Cross-origin browser requests are only honored for trusted origins:
		// loopback (any port) or the server's own host (same-origin, including
		// the optional tunnel host). The devtools UI is always served from one
		// of these, so legitimate usage is unaffected. A wildcard ACAO here
		// would let any visited website read local project data cross-origin.
		if origin != "" {
			if !originAllowed(r) {
				// Disallowed cross-origin request: omit CORS headers so the
				// browser blocks reading the response. Reject preflight outright.
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				http.Error(w, "cross-origin request denied", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Bypass-Tunnel-Reminder")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
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
