package localserver

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func registerRuntimeRoutes(mux *http.ServeMux, devtoolsSvc *devtools.Service, projectRoot string) {
	mux.HandleFunc("GET /api/runtime", func(w http.ResponseWriter, r *http.Request) {
		runRuntimeRouteOperation(w, r, devtoolsSvc, projectRoot, "status", "", true)
	})

	mux.HandleFunc("GET /api/runtime/work/{workId}", func(w http.ResponseWriter, r *http.Request) {
		runRuntimeRouteOperation(w, r, devtoolsSvc, projectRoot, "inspect", r.PathValue("workId"), false)
	})

	mux.HandleFunc("POST /api/runtime/work/{workId}/retry", func(w http.ResponseWriter, r *http.Request) {
		runRuntimeRouteOperation(w, r, devtoolsSvc, projectRoot, "retry", r.PathValue("workId"), false)
	})

	mux.HandleFunc("POST /api/runtime/work/{workId}/cancel", func(w http.ResponseWriter, r *http.Request) {
		runRuntimeRouteOperation(w, r, devtoolsSvc, projectRoot, "cancel", r.PathValue("workId"), false)
	})
}

func runRuntimeRouteOperation(
	w http.ResponseWriter,
	r *http.Request,
	devtoolsSvc *devtools.Service,
	projectRoot string,
	operation string,
	workID string,
	includeDetails bool,
) {
	if devtoolsSvc == nil {
		http.Error(w, "devtools service unavailable", http.StatusServiceUnavailable)
		return
	}
	root, err := runtimeRouteRoot(projectRoot)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	raw, err := devtoolsSvc.RunRuntimeOperation(r.Context(), root, operation, workID, includeDetails)
	if err != nil {
		slog.Warn("runtime operation failed", "operation", operation, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

func runtimeRouteRoot(projectRoot string) (string, error) {
	if projectRoot != "" {
		return projectRoot, nil
	}
	return os.Getwd()
}
