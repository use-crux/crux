package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ServerOptions configures the HTTP server.
type ServerOptions struct {
	// SourceResolverScript is the path to source-resolver.mjs.
	// If empty, source resolution endpoints return 501.
	SourceResolverScript string
	// ProjectIndexerScript is the path to project-indexer.mjs.
	// If empty, project reindex endpoints return 501.
	ProjectIndexerScript string
	// QualityDir is the local quality workbench directory.
	// Defaults to .crux/quality relative to the server working directory.
	QualityDir string
	// ObservabilityDBPath is the local SQLite path for canonical graph records.
	// Defaults to an in-memory database for direct handler construction.
	ObservabilityDBPath  string
	ObservabilityService *observability.Service
	RuntimeBridge        *runtimebridge.Service
	RuntimeEvalRunner    runtimebridge.EvalRunner
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
	if opt.ProjectIndexerScript != "" {
		projectIndexer := NewProjectIndexWorker(opt.ProjectIndexerScript)
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
	if opt.RuntimeEvalRunner != nil {
		runtimeBridge.WithEvalRunner(opt.RuntimeEvalRunner)
	} else {
		runtimeBridge.WithEvalRunner(EvalBridgeRunner{CWD: opt.ProjectRoot, ConfigPath: opt.ConfigPath})
	}
	resourceInspection := resourceinspection.New(runtimeBridge)
	devSvc.WithResourceInspection(resourceInspection)
	wsHub := NewWSHub(ctx, devSvc, qualitySvc.Events(), observabilityEvents, runtimeBridge)
	go discoverRuntimeBridgePeers(ctx, runtimeBridge, opt.ProjectRoot)

	mux := http.NewServeMux()

	// WebSocket upgrade
	mux.HandleFunc("/ws/ui", wsHub.HandleUpgrade)
	mux.HandleFunc("/ws/runtime", handleRuntimeBridgeUpgrade(runtimeBridge))
	mux.HandleFunc("GET /api/runtime/bridge/peers", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, runtimeBridge.Peers())
	})
	mux.HandleFunc("POST /api/runtime/bridge/peers", func(w http.ResponseWriter, r *http.Request) {
		var peer runtimebridge.Peer
		if err := json.NewDecoder(r.Body).Decode(&peer); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if peer.Transport == "" {
			peer.Transport = runtimebridge.TransportHTTP
		}
		// HTTP peers are dispatched to by the server, so confine their callback
		// URL to loopback (these are local app runtimes) to prevent SSRF.
		if peer.Transport == runtimebridge.TransportHTTP && !runtimebridge.IsLoopbackEndpoint(peer.EndpointURL) {
			http.Error(w, "HTTP runtime peer endpointUrl must be a loopback address", http.StatusBadRequest)
			return
		}
		writeJSON(w, runtimeBridge.RegisterPeer(peer, nil))
	})
	mux.HandleFunc("POST /api/runtime/bridge/commands", func(w http.ResponseWriter, r *http.Request) {
		var req runtimebridge.DispatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		resp, err := runtimeBridge.Dispatch(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, resp)
	})
	mux.HandleFunc("GET /api/resources/capabilities", func(w http.ResponseWriter, r *http.Request) {
		caps, err := resourceInspection.Capabilities(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, caps)
	})
	mux.HandleFunc("GET /api/resources/{resourceId}", func(w http.ResponseWriter, r *http.Request) {
		result, err := resourceInspection.Get(r.Context(), resourceinspection.GetRequest{
			ResourceID: r.PathValue("resourceId"),
			Key:        r.URL.Query().Get("key"),
			PeerID:     r.URL.Query().Get("peerId"),
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
	})
	mux.HandleFunc("GET /api/resources/{resourceId}/entries", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		result, err := resourceInspection.List(r.Context(), resourceinspection.ListRequest{
			ResourceID: r.PathValue("resourceId"),
			Prefix:     r.URL.Query().Get("prefix"),
			Cursor:     r.URL.Query().Get("cursor"),
			Limit:      limit,
			PeerID:     r.URL.Query().Get("peerId"),
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
	})

	mux.HandleFunc("GET /api/quality/activity", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		events, err := qualitySvc.RecentActivity(r.Context(), limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, events)
	})

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
	mux.HandleFunc("GET /api/index", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/project/index", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/index/events", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	indexReindexHandler := func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Root         string   `json:"root,omitempty"`
			ConfigPath   string   `json:"configPath,omitempty"`
			ProjectName  string   `json:"projectName,omitempty"`
			Files        []string `json:"files,omitempty"`
			DeletedFiles []string `json:"deletedFiles,omitempty"`
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
		if len(req.Files) > 0 || len(req.DeletedFiles) > 0 {
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

	// Evals
	mux.HandleFunc("GET /api/evals", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/evals/{evalId}", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/evals/baseline/{promptId}", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/rag-evals", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/rag-evals/{evalId}", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/quality/overview", func(w http.ResponseWriter, r *http.Request) {
		overview, err := qualitySvc.Overview(r.Context())
		if err != nil {
			slog.Warn("quality overview read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, overview)
	})
	mux.HandleFunc("GET /api/quality/runs", func(w http.ResponseWriter, r *http.Request) {
		opts := parseRunsOptions(r.URL.Query())
		runs, err := qualitySvc.RunsWithOptions(r.Context(), opts)
		if err != nil {
			slog.Warn("quality runs read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, runs)
	})
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
	mux.HandleFunc("GET /api/quality/runs/{traceId}", func(w http.ResponseWriter, r *http.Request) {
		detail, found, err := qualitySvc.RunDetail(r.Context(), r.PathValue("traceId"))
		if err != nil {
			slog.Warn("quality run detail read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if !found {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, detail)
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
	mux.HandleFunc("GET /api/quality/suites", func(w http.ResponseWriter, r *http.Request) {
		suites, err := qualitySvc.Suites(r.Context())
		if err != nil {
			slog.Warn("quality suites read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, suites)
	})
	mux.HandleFunc("GET /api/quality/suites/{suiteId}", func(w http.ResponseWriter, r *http.Request) {
		suite, found, err := qualitySvc.Suite(r.Context(), r.PathValue("suiteId"))
		if err != nil {
			slog.Warn("quality suite read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if !found {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, suite)
	})
	mux.HandleFunc("POST /api/quality/suites", func(w http.ResponseWriter, r *http.Request) {
		var req quality.SuiteRecord
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.SaveSuite(r.Context(), req)
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
	mux.HandleFunc("PUT /api/quality/suites/{suiteId}", func(w http.ResponseWriter, r *http.Request) {
		var req quality.SuiteRecord
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		req.SuiteID = r.PathValue("suiteId")
		record, err := qualitySvc.SaveSuite(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, record)
	})
	mux.HandleFunc("POST /api/quality/suites/{suiteId}/cases", func(w http.ResponseWriter, r *http.Request) {
		var req quality.SuiteCase
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.UpsertSuiteCase(r.Context(), r.PathValue("suiteId"), req)
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
	mux.HandleFunc("GET /api/quality/insights", func(w http.ResponseWriter, r *http.Request) {
		insights, err := qualitySvc.Insights(r.Context())
		if err != nil {
			slog.Warn("quality insights read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, insights)
	})
	mux.HandleFunc("GET /api/quality/insights/silences", func(w http.ResponseWriter, r *http.Request) {
		silences, err := qualitySvc.InsightSilences(r.Context(), r.URL.Query().Get("include") == "deleted")
		if err != nil {
			slog.Warn("quality insight silences read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, silences)
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
	mux.HandleFunc("GET /api/quality/experiments", func(w http.ResponseWriter, r *http.Request) {
		experiments, err := qualitySvc.Experiments(r.Context())
		if err != nil {
			slog.Warn("quality experiments read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, experiments)
	})
	mux.HandleFunc("GET /api/quality/experiments/{experimentId}", func(w http.ResponseWriter, r *http.Request) {
		experiment, err := qualitySvc.Experiment(r.Context(), r.PathValue("experimentId"))
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, experiment)
	})
	mux.HandleFunc("GET /api/quality/comparisons", func(w http.ResponseWriter, r *http.Request) {
		comparisons, err := qualitySvc.Comparisons(r.Context())
		if err != nil {
			slog.Warn("quality comparisons read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, comparisons)
	})
	mux.HandleFunc("GET /api/quality/comparisons/{comparisonId}", func(w http.ResponseWriter, r *http.Request) {
		record, err := qualitySvc.Comparison(r.Context(), r.PathValue("comparisonId"))
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, record)
	})
	mux.HandleFunc("POST /api/quality/comparisons", func(w http.ResponseWriter, r *http.Request) {
		var req quality.ComparisonPostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.CreateComparison(r.Context(), req)
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
	mux.HandleFunc("GET /api/quality/baselines", func(w http.ResponseWriter, r *http.Request) {
		baselines, err := qualitySvc.Baselines(r.Context())
		if err != nil {
			slog.Warn("quality baselines read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, baselines)
	})
	mux.HandleFunc("GET /api/quality/baselines/{baselineId}", func(w http.ResponseWriter, r *http.Request) {
		record, err := qualitySvc.Baseline(r.Context(), r.PathValue("baselineId"))
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, record)
	})
	mux.HandleFunc("POST /api/quality/baselines", func(w http.ResponseWriter, r *http.Request) {
		var req quality.BaselinePostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.CreateBaseline(r.Context(), req)
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
	mux.HandleFunc("GET /api/quality/cassettes", func(w http.ResponseWriter, r *http.Request) {
		cassettes, err := qualitySvc.Cassettes(r.Context())
		if err != nil {
			slog.Warn("quality cassettes read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, cassettes)
	})
	mux.HandleFunc("POST /api/quality/cassettes/issues", func(w http.ResponseWriter, r *http.Request) {
		var req quality.CassetteIssueRecord
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := qualitySvc.CreateCassetteIssue(r.Context(), req)
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
	mux.HandleFunc("GET /api/quality/feedback", func(w http.ResponseWriter, r *http.Request) {
		feedback, err := qualitySvc.Feedback(r.Context())
		if err != nil {
			slog.Warn("quality feedback read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, feedback)
	})
	mux.HandleFunc("GET /api/quality/feedback/annotations", func(w http.ResponseWriter, r *http.Request) {
		annotations, err := qualitySvc.FeedbackAnnotations(r.Context())
		if err != nil {
			slog.Warn("quality feedback annotations read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, annotations)
	})
	mux.HandleFunc("GET /api/quality/feedback/memory-proposals", func(w http.ResponseWriter, r *http.Request) {
		proposals, err := qualitySvc.MemoryProposals(r.Context())
		if err != nil {
			slog.Warn("quality feedback memory proposals read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, proposals)
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
	mux.HandleFunc("GET /api/quality/scorers", func(w http.ResponseWriter, r *http.Request) {
		scorers, err := qualitySvc.Scorers(r.Context())
		if err != nil {
			slog.Warn("quality scorers read failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, scorers)
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

	// Flows
	mux.HandleFunc("GET /api/flows", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/flows/{flowId}", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})

	// Runtime flows
	mux.HandleFunc("GET /api/runtime-flows", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})

	// Stats
	mux.HandleFunc("GET /api/stats", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/stats/timeseries", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/stats/baselines", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/stats/prompt-usage", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/stats/dropped-contexts", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/stats/judge-timeseries", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})

	// Memory
	mux.HandleFunc("GET /api/memory", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/memory/instances", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/memory/instances/{memoryId}", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/memory/stores", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/memory/operations", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.String())
	})
	mux.HandleFunc("GET /api/memory/stores/", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})

	// Events by type
	mux.HandleFunc("GET /api/compaction", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/budget", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/cost", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/corpus", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/ingest", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/agent", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/compositions/stats", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/judges", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/tools/events", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/security/events", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/security/by-prompt", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/plans", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/plans/", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/workspaces", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/workspaces/", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/tasklists", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/tasks", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/guardrails", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/constraints", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})

	// Timeline
	mux.HandleFunc("GET /api/timeline", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})

	// Sessions
	mux.HandleFunc("GET /api/sessions", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})
	mux.HandleFunc("GET /api/devtools/context", func(w http.ResponseWriter, r *http.Request) {
		writeDevtoolsJSON(w, r, devSvc, r.URL.Path)
	})

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	// Source resolution — delegates to Node.js worker
	var sourceWorker *SourceWorker
	if opt.SourceResolverScript != "" {
		sourceWorker = NewSourceWorker(opt.SourceResolverScript)
	}
	mux.HandleFunc("POST /api/resolve-source", func(w http.ResponseWriter, r *http.Request) {
		if sourceWorker == nil {
			http.Error(w, "source resolver not configured", http.StatusNotImplemented)
			return
		}
		var req struct {
			Locations []SourceLocation `json:"locations"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		resolved, err := sourceWorker.ResolveLocations(req.Locations)
		if err != nil {
			slog.Error("source resolution failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"locations": resolved})
	})
	mux.HandleFunc("POST /api/resolve-fn-source", func(w http.ResponseWriter, r *http.Request) {
		if sourceWorker == nil {
			http.Error(w, "source resolver not configured", http.StatusNotImplemented)
			return
		}
		var req struct {
			File   string `json:"file"`
			Line   int    `json:"line"`
			Column *int   `json:"column,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		result, err := sourceWorker.ResolveFnSource(req.File, req.Line, req.Column)
		if err != nil {
			slog.Error("fn source resolution failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
	})

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

func writeDevtoolsJSON(w http.ResponseWriter, r *http.Request, service *devtools.Service, path string) {
	value, found, err := service.Get(r.Context(), path, r.URL.Query())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !found {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, value)
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
