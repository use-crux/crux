package server

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// ProjectIndex returns the hub's coherent, generation-stamped Project Index
// view. The first read populates that view lazily when startup indexing has not
// published a snapshot yet.
func (h *WSHub) ProjectIndex(_ context.Context) (api.IndexData, error) {
	h.indexMu.Lock()
	defer h.indexMu.Unlock()
	return h.projectIndexLocked()
}

func (h *WSHub) projectIndexLocked() (api.IndexData, error) {
	if !h.hasLastIndex {
		if h.devtools == nil {
			return api.IndexData{}, fmt.Errorf("project index service is unavailable")
		}
		h.lastIndex = h.devtools.ProjectIndexSnapshot()
		h.hasLastIndex = true
	}

	encoded, err := json.Marshal(h.lastIndex)
	if err != nil {
		return api.IndexData{}, fmt.Errorf("encode hub Project Index snapshot: %w", err)
	}
	var snapshot api.IndexData
	if err := json.Unmarshal(encoded, &snapshot); err != nil {
		return api.IndexData{}, fmt.Errorf("decode hub Project Index snapshot: %w", err)
	}
	snapshot.ProjectRoot = h.projectRoot
	snapshot.ServerVersion = h.serverVersion
	snapshot.Generation = h.indexGeneration
	return snapshot, nil
}

// ProjectIndexWatchStatus delegates watch status without changing snapshot
// generation ownership.
func (h *WSHub) ProjectIndexWatchStatus(ctx context.Context) (api.ProjectIndexWatchStatus, error) {
	if h.devtools == nil {
		return api.ProjectIndexWatchStatus{}, fmt.Errorf("project index service is unavailable")
	}
	return h.devtools.ProjectIndexWatchStatus(ctx)
}

func (h *WSHub) emptyProjectIndexLocked() api.IndexData {
	return api.IndexData{
		ProjectRoot:   h.projectRoot,
		ServerVersion: h.serverVersion,
		Generation:    h.indexGeneration,
	}
}
