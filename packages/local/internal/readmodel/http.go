package readmodel

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

func (h *Handle[D, T]) Mount(mux *http.ServeMux, deps D, logger *slog.Logger) {
	handler := func(w http.ResponseWriter, r *http.Request) {
		value, err := h.Call(r.Context(), deps)
		writeHTTPResponse(w, logger, h.pattern, value, err)
	}
	mux.HandleFunc(h.pattern, handler)
	for _, alias := range h.aliases {
		mux.HandleFunc(alias, handler)
	}
}

func (h *ParamHandle[D, P, T]) Mount(mux *http.ServeMux, deps D, logger *slog.Logger) {
	mux.HandleFunc(h.pattern, func(w http.ResponseWriter, r *http.Request) {
		params := h.newParams()
		err := params.Parse(Req{Path: r.URL.Path, PathValue: r.PathValue, Query: r.URL.Query()})
		var value T
		if err == nil {
			value, err = h.Call(r.Context(), deps, params)
		}
		writeHTTPResponse(w, logger, h.pattern, value, err)
	})
}

// Mount registers each read-model endpoint with an optional scoped logger.
// In-process clients may omit the logger to retain process-default behavior.
func Mount[D any](mux *http.ServeMux, deps D, reg *Registry[D], loggers ...*slog.Logger) {
	logger := slog.Default()
	if len(loggers) > 0 && loggers[0] != nil {
		logger = loggers[0]
	}
	for _, endpoint := range reg.Endpoints() {
		endpoint.Mount(mux, deps, logger)
	}
}

func writeHTTPResponse(w http.ResponseWriter, logger *slog.Logger, pattern string, value any, err error) {
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		} else {
			var badRequest badRequestError
			if errors.As(err, &badRequest) {
				status = http.StatusBadRequest
			} else {
				logger.Error("readmodel endpoint failed", "route", pattern, "error", err)
			}
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		logger.Error("readmodel JSON encode failed", "route", pattern, "error", err)
	}
}
