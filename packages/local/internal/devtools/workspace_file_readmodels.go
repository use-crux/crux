package devtools

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func workspaceSummaryFromEvents(id string, events []store.WorkspaceEventData) workspaceSummary {
	runs := map[string]bool{}
	mounts := map[string]map[string]bool{}
	var durations []float64
	errors := 0
	last := int64(0)
	namespace := ""
	for _, event := range events {
		if event.TraceID != "" {
			runs[event.TraceID] = true
		}
		if namespace == "" {
			namespace = event.Namespace
		}
		if event.Status == "error" || event.Status == "err" {
			errors++
		}
		durations = append(durations, event.DurationMs)
		last = maxInt64(last, event.Timestamp)
	}
	for _, file := range workspaceFilesFromEvents(events) {
		mount := nonEmpty(file.Mount, firstPathSegment(file.Path))
		if mounts[mount] == nil {
			mounts[mount] = map[string]bool{}
		}
		if file.Path != "" && file.Path != "/" {
			mounts[mount][file.Path] = true
		}
	}
	return workspaceSummary{
		ID:            id,
		Namespace:     namespace,
		Mounts:        workspaceMounts(mounts),
		Stats:         workspaceStats{Runs: len(runs), Operations: len(events), Errors: errors, P50LatencyMs: percentile(durations, 50), P99LatencyMs: percentile(durations, 99)},
		LastTouchedAt: last,
	}
}

func workspaceFilesFromEvents(events []store.WorkspaceEventData) []workspaceFileSummary {
	files := map[string]*workspaceFileSummary{}
	counts := map[string]int{}
	pathByHash := map[string]string{}
	ordered := append([]store.WorkspaceEventData(nil), events...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Timestamp < ordered[j].Timestamp })
	for _, event := range ordered {
		if event.Path == "" || event.Path == "/" || event.Operation == "list" {
			continue
		}
		counts[event.Path]++
		if workspaceStatus(event.Status) == "ok" {
			switch event.Operation {
			case "delete":
				delete(files, event.Path)
				if event.PathHash != "" {
					delete(files, "hash:"+event.PathHash)
					delete(pathByHash, event.PathHash)
				}
				continue
			case "rename", "move":
				if event.FromPath != "" && event.FromPath != event.Path {
					delete(files, event.FromPath)
				}
				if event.FromPathHash != "" {
					if previous := pathByHash[event.FromPathHash]; previous != "" && previous != event.Path {
						delete(files, previous)
					}
					delete(files, "hash:"+event.FromPathHash)
					delete(pathByHash, event.FromPathHash)
				} else if event.PathHash != "" {
					if previous := pathByHash[event.PathHash]; previous != "" && previous != event.Path {
						delete(files, previous)
					}
					delete(files, "hash:"+event.PathHash)
					delete(pathByHash, event.PathHash)
				}
			}
		}
		current := files[event.Path]
		if current == nil || event.Timestamp >= current.LastOpAt {
			status := workspaceStatus(event.Status)
			lastError := ""
			if event.Error != nil {
				lastError = *event.Error
			}
			files[event.Path] = &workspaceFileSummary{
				Path:             event.Path,
				Mount:            nonEmpty(event.Mount, firstPathSegment(event.Path)),
				Op:               event.Operation,
				Status:           status,
				Size:             event.Size,
				Mime:             event.MimeType,
				ArtifactStatus:   event.ArtifactStatus,
				ArtifactKind:     event.ArtifactKind,
				URI:              event.URI,
				LastOpAt:         event.Timestamp,
				LastOpDurationMs: event.DurationMs,
				LastError:        lastError,
			}
		}
		if event.PathHash != "" {
			pathByHash[event.PathHash] = event.Path
		}
	}
	out := make([]workspaceFileSummary, 0, len(files))
	for path, file := range files {
		file.OperationCount = counts[path]
		out = append(out, *file)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func workspaceOpsFromEvents(events []store.WorkspaceEventData) []workspaceOpDetail {
	out := make([]workspaceOpDetail, 0, len(events))
	for _, event := range events {
		out = append(out, workspaceOpDetail{
			EventID:        eventID("workspace", event.TraceID, event.Timestamp, event.Path),
			Op:             event.Operation,
			Path:           event.Path,
			DurationMs:     event.DurationMs,
			Status:         workspaceStatus(event.Status),
			Bytes:          event.Size,
			Mime:           event.MimeType,
			ArtifactStatus: event.ArtifactStatus,
			ArtifactKind:   event.ArtifactKind,
			URI:            event.URI,
			TraceID:        event.TraceID,
			Error:          derefString(event.Error),
			Timestamp:      event.Timestamp,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	return out
}

func workspaceFileOpsFromEvents(events []store.WorkspaceEventData) []workspaceFileOp {
	out := make([]workspaceFileOp, 0, len(events))
	for _, event := range events {
		out = append(out, workspaceFileOp{
			EventID:    eventID("workspace-file", event.TraceID, event.Timestamp, event.Path),
			Op:         event.Operation,
			TraceID:    event.TraceID,
			DurationMs: event.DurationMs,
			Timestamp:  event.Timestamp,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	return out
}
