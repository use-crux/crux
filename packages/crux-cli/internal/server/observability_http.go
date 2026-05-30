package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/observability"
	"github.com/anthropics/crux-cli/internal/quality"
)

func registerObservabilityHTTP(mux *http.ServeMux, service *observability.Service, qualityEvents *quality.EventBus) {
	mux.HandleFunc("POST /api/observability/records", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}

		var batch observability.Batch
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if err := service.Ingest(r.Context(), batch); err != nil {
			slog.Warn("observability ingest failed", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if qualityEvents != nil {
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
		if err := json.NewEncoder(w).Encode(map[string]any{"accepted": len(batch.Records)}); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})

	mux.HandleFunc("GET /api/observability/runs", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		runs, err := service.Runs(r.Context())
		writeObservabilityRead(w, runs, err)
	})

	mux.HandleFunc("GET /api/observability/runs/{runId}", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		detail, err := service.RunDetail(r.Context(), r.PathValue("runId"))
		writeObservabilityRead(w, detail, err)
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
