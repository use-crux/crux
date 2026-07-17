package localserver

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/inspect"
)

func registerInspectRoutes(mux *http.ServeMux, inspectSvc *inspect.Service) {
	mux.HandleFunc("DELETE /api/inspect/runs", func(w http.ResponseWriter, r *http.Request) {
		if inspectSvc == nil {
			http.Error(w, "Inspect service unavailable", http.StatusServiceUnavailable)
			return
		}
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
		record, err := inspectSvc.DeleteRuns(r.Context(), req.TraceIDs)
		if err != nil {
			slog.Warn("quality runs delete failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, record)
	})

	mux.HandleFunc("DELETE /api/inspect/runs/{traceId}", func(w http.ResponseWriter, r *http.Request) {
		if inspectSvc == nil {
			http.Error(w, "Inspect service unavailable", http.StatusServiceUnavailable)
			return
		}
		traceID := r.PathValue("traceId")
		record, err := inspectSvc.DeleteRuns(r.Context(), []string{traceID})
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

	mux.HandleFunc("POST /api/inspect/insights/silences", func(w http.ResponseWriter, r *http.Request) {
		if inspectSvc == nil {
			http.Error(w, "Inspect service unavailable", http.StatusServiceUnavailable)
			return
		}
		var req inspect.InsightSilenceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := inspectSvc.CreateInsightSilence(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeCreatedJSON(w, record)
	})

	mux.HandleFunc("DELETE /api/inspect/insights/silences/{silenceId}", func(w http.ResponseWriter, r *http.Request) {
		if inspectSvc == nil {
			http.Error(w, "Inspect service unavailable", http.StatusServiceUnavailable)
			return
		}
		record, err := inspectSvc.DeleteInsightSilence(r.Context(), r.PathValue("silenceId"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, record)
	})

	mux.HandleFunc("POST /api/inspect/insights/{insightId}/status", func(w http.ResponseWriter, r *http.Request) {
		if inspectSvc == nil {
			http.Error(w, "Inspect service unavailable", http.StatusServiceUnavailable)
			return
		}
		var req inspect.InsightStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		record, err := inspectSvc.SetInsightStatus(r.Context(), r.PathValue("insightId"), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeCreatedJSON(w, record)
	})
}

func writeCreatedJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("JSON encode error", "error", err)
	}
}
