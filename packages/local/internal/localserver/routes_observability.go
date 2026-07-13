package localserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
)

func registerObservabilityRoutes(mux *http.ServeMux, service *observability.Service, qualityEvents *quality.EventBus) {
	mux.HandleFunc("POST /api/observability/records", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxObservabilityRequestBytes)
		var batch observability.Batch
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			status := http.StatusBadRequest
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				status = http.StatusRequestEntityTooLarge
			}
			http.Error(w, http.StatusText(status), status)
			return
		}
		if batch.SchemaVersion != observability.SchemaVersion {
			writeUnsupportedObservabilitySchema(w, batch)
			return
		}
		if batch.SourceHealth != nil {
			if err := service.RecordSourceHealth(r.Context(), *batch.SourceHealth); err != nil {
				slog.Warn("observability source health rejected", "error", err)
			}
		}
		dispositions := service.IngestWithDispositions(r.Context(), batch)
		accepted := 0
		retryable := false
		for _, disposition := range dispositions {
			if disposition.Outcome == "accepted" {
				accepted++
			}
			if disposition.Retryable {
				retryable = true
			}
		}
		if retryable {
			w.Header().Set("Retry-After", "1")
		}
		if qualityEvents != nil && accepted > 0 {
			qualityEvents.Publish(api.QualityEvent{
				Tag:       "QualityEvent",
				Timestamp: time.Now().UnixMilli(),
				Kind:      "refresh",
				Action:    "observability ingested",
				Severity:  "info",
				RefID:     observabilityRefreshRefID(batch),
			})
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		if err := json.NewEncoder(w).Encode(observabilityIngestResponse{Dispositions: dispositions}); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})

	// GET /api/observability/runs/page is the joined, revisioned Runs read
	// model (binding spec 04 §3-4): stable filters/pagination executed in SQL
	// before enrichment, a server-owned revision, and a stable next cursor.
	// This is the only runs list HTTP surface (DevTools, TUI/CLI facades, tests).
	mux.HandleFunc("GET /api/observability/runs/page", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		page, err := service.RunsPage(r.Context(), parseObservabilityRunListOptions(r))
		writeObservabilityRead(w, page, err)
	})

	// GET /api/observability/runs/delta is the bounded catch-up endpoint for a
	// reconnecting client presenting the last revision it applied.
	mux.HandleFunc("GET /api/observability/runs/delta", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		since, err := parseObservabilityRevisionQueryParam(r, "since")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		delta, err := service.RunsSince(r.Context(), since)
		writeObservabilityRead(w, delta, err)
	})

	// GET /api/observability/definitions/{definitionId}/runs is the
	// filtered-by-definition Runs query (binding spec 03 §4.4): "runs whose
	// DefinitionRefs include definition X", backed by the derived
	// run_definition_activity projection. It returns the same revisioned
	// {Revision, Rows, NextCursor} envelope and honors the same status/session/
	// time-range/cursor filters as the page route, so DevTools' existing
	// revision-aware catch-up needs no new invalidation model.
	mux.HandleFunc("GET /api/observability/definitions/{definitionId}/runs", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		opts := parseObservabilityRunListOptions(r)
		opts.DefinitionID = r.PathValue("definitionId")
		page, err := service.RunsPage(r.Context(), opts)
		writeObservabilityRead(w, page, err)
	})

	// GET /api/observability/definitions/{definitionId}/activity is the Catalog
	// rollup for one definition: a distinct-run count plus the newest matching
	// run (fully enriched, including delivery health). It never validates the
	// id against the current Project Index snapshot — the DevTools UI owns
	// that read-time resolution, per binding spec 04 §2.
	mux.HandleFunc("GET /api/observability/definitions/{definitionId}/activity", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		summary, err := service.DefinitionActivitySummary(r.Context(), r.PathValue("definitionId"))
		writeObservabilityRead(w, summary, err)
	})

	mux.HandleFunc("GET /api/observability/runs/{runId}", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		detail, err := service.RunDetail(r.Context(), r.PathValue("runId"))
		writeObservabilityRead(w, detail, err)
	})

	mux.HandleFunc("GET /api/observability/runs/{runId}/spans/{spanId}/events", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		events, err := service.SpanEvents(
			r.Context(),
			r.PathValue("runId"),
			r.PathValue("spanId"),
			parseObservabilitySpanEventListOptions(r),
		)
		writeObservabilityRead(w, events, err)
	})

	mux.HandleFunc("GET /api/observability/runs/{runId}/graph", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		graph, err := service.Graph(r.Context(), r.PathValue("runId"))
		writeObservabilityRead(w, graph, err)
	})

	mux.HandleFunc("GET /api/observability/resources/{family}", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		activity, err := service.ResourceActivity(r.Context(), r.PathValue("family"))
		writeObservabilityRead(w, activity, err)
	})
}

func parseObservabilityRunListOptions(r *http.Request) observability.RunListOptions {
	opts := observability.RunListOptions{}
	if value := r.URL.Query().Get("limit"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			opts.Limit = parsed
		}
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			opts.Offset = parsed
		}
	}
	opts.SessionID = r.URL.Query().Get("sessionId")
	if value := r.URL.Query().Get("status"); value != "" {
		opts.Status = strings.Split(value, ",")
	}
	opts.Since = r.URL.Query().Get("since")
	opts.Until = r.URL.Query().Get("until")
	opts.Cursor = r.URL.Query().Get("cursor")
	opts.DefinitionID = r.URL.Query().Get("definitionId")
	return opts
}

func parseObservabilityRevisionQueryParam(r *http.Request, name string) (int64, error) {
	value := r.URL.Query().Get(name)
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s query parameter", name)
	}
	return parsed, nil
}

func parseObservabilitySpanEventListOptions(r *http.Request) observability.SpanEventListOptions {
	opts := observability.SpanEventListOptions{
		Name:  r.URL.Query().Get("name"),
		After: r.URL.Query().Get("after"),
	}
	if value := r.URL.Query().Get("limit"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			opts.Limit = parsed
		}
	}
	return opts
}

type observabilityIngestResponse struct {
	Dispositions []observability.IngestDisposition `json:"dispositions"`
}

const maxObservabilityRequestBytes = 1024 * 1024

func writeUnsupportedObservabilitySchema(w http.ResponseWriter, batch observability.Batch) {
	dispositions := make([]observability.IngestDisposition, 0, len(batch.Records))
	for index, record := range batch.Records {
		dispositions = append(dispositions, observability.IngestDisposition{
			Index: index, RecordID: record.RecordID, Outcome: "rejected",
			Code: "unsupported_schema_version", Message: "unsupported observability batch schema version", Retryable: false,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnprocessableEntity)
	_ = json.NewEncoder(w).Encode(observabilityIngestResponse{Dispositions: dispositions})
}

func observabilityRefreshRefID(batch observability.Batch) string {
	for _, record := range batch.Records {
		if record.RunID != "" {
			return record.RunID
		}
	}
	return "observability"
}

func writeObservabilityRead(w http.ResponseWriter, value any, err error) {
	if err != nil {
		if errors.Is(err, observability.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		slog.Warn("observability read failed", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, value)
}
