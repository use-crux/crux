package localserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func registerIndexRoutes(mux *http.ServeMux, devtoolsSvc *devtools.Service) {
	mux.HandleFunc("POST /api/index/runtime-update", func(w http.ResponseWriter, r *http.Request) {
		if devtoolsSvc == nil {
			http.Error(w, "devtools service unavailable", http.StatusServiceUnavailable)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxProjectIndexRuntimeUpdateRequestBytes)
		var update projectindex.ProjectIndexRuntimeUpdate
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&update); err != nil {
			status := http.StatusBadRequest
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				status = http.StatusRequestEntityTooLarge
			}
			http.Error(w, http.StatusText(status), status)
			return
		}
		if _, err := devtoolsSvc.ApplyProjectIndexRuntimeUpdate(r.Context(), update); err != nil {
			status := http.StatusServiceUnavailable
			message := "project index runtime update unavailable"
			if projectindex.IsRuntimeUpdateValidationError(err) {
				status = http.StatusBadRequest
				message = "invalid runtime update"
			} else if projectindex.IsRuntimeUpdateConflict(err) {
				status = http.StatusConflict
				message = "MCP tool name collision; configure a prefix"
			}
			http.Error(w, message, status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("POST /api/index/snapshot", func(w http.ResponseWriter, r *http.Request) {
		if devtoolsSvc == nil {
			http.Error(w, "devtools service unavailable", http.StatusServiceUnavailable)
			return
		}
		var snapshot store.IndexData
		if err := json.NewDecoder(r.Body).Decode(&snapshot); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if snapshot.SchemaVersion != 0 && snapshot.SchemaVersion != 1 {
			http.Error(w, "unsupported index schemaVersion", http.StatusBadRequest)
			return
		}
		devtoolsSvc.RegisterIndexSnapshot(r.Context(), snapshot)
		w.WriteHeader(http.StatusNoContent)
	})

	indexReindexHandler := func(w http.ResponseWriter, r *http.Request) {
		if devtoolsSvc == nil {
			http.Error(w, "devtools service unavailable", http.StatusServiceUnavailable)
			return
		}
		var req struct {
			Root         string   `json:"root,omitempty"`
			ConfigPath   string   `json:"configPath,omitempty"`
			ProjectName  string   `json:"projectName,omitempty"`
			Files        []string `json:"files,omitempty"`
			DeletedFiles []string `json:"deletedFiles,omitempty"`
			RuntimeRich  bool     `json:"runtimeRich,omitempty"`
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
		if req.RuntimeRich && (len(req.Files) > 0 || len(req.DeletedFiles) > 0) {
			http.Error(w, "runtimeRich reindex requires a full reindex request", http.StatusBadRequest)
			return
		}
		if req.RuntimeRich {
			index, err = devtoolsSvc.ReindexProjectRuntimeRich(r.Context(), root, req.ConfigPath, req.ProjectName)
		} else if len(req.Files) > 0 || len(req.DeletedFiles) > 0 {
			index, err = devtoolsSvc.ReindexProjectIncremental(r.Context(), root, req.ConfigPath, req.ProjectName, req.Files, req.DeletedFiles)
		} else {
			index, err = devtoolsSvc.ReindexProject(r.Context(), root, req.ConfigPath, req.ProjectName)
		}
		if err != nil {
			requestLogger(r).Error("project index reindex failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, r, index)
	}
	mux.HandleFunc("POST /api/project/index/reindex", indexReindexHandler)
	mux.HandleFunc("POST /api/index/reindex", indexReindexHandler)
}

const maxProjectIndexRuntimeUpdateRequestBytes = 4 * 1024 * 1024
