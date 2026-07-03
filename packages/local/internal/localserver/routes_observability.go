package localserver

import (
	"encoding/json"
	"errors"
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

		var batch observability.Batch
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		accepted, rejected := validateObservabilityBatch(batch)
		if len(accepted.Records) > 0 {
			if err := service.Ingest(r.Context(), accepted); err != nil {
				slog.Warn("observability ingest failed", "error", err)
				if isTransientObservabilityIngestError(err) {
					w.Header().Set("Retry-After", "1")
					http.Error(w, err.Error(), http.StatusServiceUnavailable)
					return
				}
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		if qualityEvents != nil {
			qualityEvents.Publish(api.QualityEvent{
				Tag:       "QualityEvent",
				Timestamp: time.Now().UnixMilli(),
				Kind:      "refresh",
				Action:    "observability ingested",
				Severity:  "info",
				RefID:     observabilityRefreshRefID(accepted),
			})
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		if err := json.NewEncoder(w).Encode(observabilityIngestResponse{Accepted: len(accepted.Records), Rejected: rejected}); err != nil {
			slog.Error("JSON encode error", "error", err)
		}
	})

	mux.HandleFunc("GET /api/observability/runs", func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "observability service unavailable", http.StatusServiceUnavailable)
			return
		}
		runs, err := service.RunsWithOptions(r.Context(), parseObservabilityRunListOptions(r))
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
	return opts
}

type observabilityIngestResponse struct {
	Accepted int                           `json:"accepted"`
	Rejected []observabilityRejectedRecord `json:"rejected"`
}

type observabilityRejectedRecord struct {
	RecordID string `json:"recordId"`
	Error    string `json:"error"`
}

func validateObservabilityBatch(batch observability.Batch) (observability.Batch, []observabilityRejectedRecord) {
	accepted := observability.Batch{Records: make([]observability.Record, 0, len(batch.Records))}
	rejected := make([]observabilityRejectedRecord, 0)
	for _, record := range batch.Records {
		if err := observability.ValidateRecord(record); err != nil {
			rejected = append(rejected, observabilityRejectedRecord{
				RecordID: record.RecordID,
				Error:    err.Error(),
			})
			continue
		}
		accepted.Records = append(accepted.Records, record)
	}
	return accepted, rejected
}

func isTransientObservabilityIngestError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "begin observability ingest transaction") ||
		strings.Contains(message, "commit observability ingest transaction") ||
		strings.Contains(message, "sqlite_busy") ||
		strings.Contains(message, "database is locked") ||
		strings.Contains(message, "database is busy") ||
		strings.Contains(message, "database is closed")
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
