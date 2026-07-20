package localserver

import (
	"encoding/json"
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
			OperationIDs []string `json:"operationIds"`
			TraceIDs     []string `json:"traceIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		ids := req.OperationIDs
		if len(ids) == 0 {
			ids = req.TraceIDs
		}
		if len(ids) == 0 {
			http.Error(w, "operationIds is required", http.StatusBadRequest)
			return
		}
		record, err := inspectSvc.DeleteRuns(r.Context(), ids)
		if err != nil {
			requestLogger(r).Warn("Inspect runs delete failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, r, record)
	})

	mux.HandleFunc("DELETE /api/inspect/runs/{operationId}", func(w http.ResponseWriter, r *http.Request) {
		if inspectSvc == nil {
			http.Error(w, "Inspect service unavailable", http.StatusServiceUnavailable)
			return
		}
		operationID := r.PathValue("operationId")
		record, err := inspectSvc.DeleteRuns(r.Context(), []string{operationID})
		if err != nil {
			requestLogger(r).Warn("Inspect run delete failed", "error", err, "operationId", operationID)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(record.DeletedOperationIDs) == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, r, record)
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
		writeCreatedJSON(w, r, record)
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
		writeJSON(w, r, record)
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
		writeCreatedJSON(w, r, record)
	})
}

func writeCreatedJSON(w http.ResponseWriter, r *http.Request, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		requestLogger(r).Error("JSON encode error", "error", err)
	}
}
