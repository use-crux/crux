package source

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
)

func RegisterRoutes(mux *http.ServeMux, scriptPath string, embeddedScript []byte, projectRoot string, logger *slog.Logger, stderr io.Writer) {
	if logger == nil {
		logger = slog.Default()
	}
	worker := New(scriptPath, embeddedScript, projectRoot, WorkerOptions{Logger: logger, Stderr: stderr})
	mux.HandleFunc("POST /api/resolve-source", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Locations []Location `json:"locations"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		resolved, err := worker.ResolveLocations(r.Context(), req.Locations)
		if err != nil {
			logger.Error("source resolution failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"locations": resolved})
	})
	mux.HandleFunc("POST /api/resolve-fn-source", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			File   string `json:"file"`
			Line   int    `json:"line"`
			Column *int   `json:"column,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		result, err := worker.ResolveFn(r.Context(), req.File, req.Line, req.Column)
		if err != nil {
			logger.Error("fn source resolution failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
	})
	mux.HandleFunc("POST /api/resolve-source-frame", func(w http.ResponseWriter, r *http.Request) {
		var req FrameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		result, err := worker.ResolveFrame(r.Context(), req)
		if err != nil {
			logger.Error("source frame resolution failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
