package localserver

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/quality"
	qualityserver "github.com/use-crux/crux/packages/local/internal/server/quality"
)

func registerQualityRoutes(
	mux *http.ServeMux,
	qualitySvc *quality.Service,
	hub Hub,
	projectRoot string,
	configPath string,
	runner qualityserver.RunnerDeps,
) {
	events := qualityEvents(qualitySvc)
	qualityserver.RegisterRunEvents(mux, hub, events)
	qualityserver.RegisterPromote(mux, projectRoot, configPath, runner, events)

	mux.HandleFunc("DELETE /api/quality/runs", func(w http.ResponseWriter, r *http.Request) {
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
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
		record, err := qualitySvc.DeleteRuns(r.Context(), req.TraceIDs)
		if err != nil {
			slog.Warn("quality runs delete failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, record)
	})

	mux.HandleFunc("DELETE /api/quality/runs/{traceId}", func(w http.ResponseWriter, r *http.Request) {
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
			return
		}
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
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
			return
		}
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
		writeCreatedJSON(w, record)
	})

	mux.HandleFunc("DELETE /api/quality/insights/silences/{silenceId}", func(w http.ResponseWriter, r *http.Request) {
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
			return
		}
		record, err := qualitySvc.DeleteInsightSilence(r.Context(), r.PathValue("silenceId"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, record)
	})

	mux.HandleFunc("POST /api/quality/insights/{insightId}/status", func(w http.ResponseWriter, r *http.Request) {
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
			return
		}
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
		writeCreatedJSON(w, record)
	})

	mux.HandleFunc("POST /api/quality/feedback/{feedbackId}/status", func(w http.ResponseWriter, r *http.Request) {
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
			return
		}
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
		writeCreatedJSON(w, record)
	})

	mux.HandleFunc("POST /api/quality/feedback/annotations", func(w http.ResponseWriter, r *http.Request) {
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
			return
		}
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
		writeCreatedJSON(w, record)
	})

	mux.HandleFunc("POST /api/quality/feedback", func(w http.ResponseWriter, r *http.Request) {
		if qualitySvc == nil {
			http.Error(w, "quality service unavailable", http.StatusServiceUnavailable)
			return
		}
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
