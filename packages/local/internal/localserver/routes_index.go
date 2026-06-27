package localserver

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func registerIndexRoutes(mux *http.ServeMux, devtoolsSvc *devtools.Service) {
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
			slog.Error("project index reindex failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, index)
	}
	mux.HandleFunc("POST /api/project/index/reindex", indexReindexHandler)
	mux.HandleFunc("POST /api/index/reindex", indexReindexHandler)
}
