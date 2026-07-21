package devtools

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// isWorkspaceVersionMarker reports whether a workspace-family activity item is a
// version-history marker rather than a file operation. Markers are emitted once
// per recorded file version and reuse the workspace primitive, so they are
// distinguished by their reserved span name. Because a single `edit`/`undo`
// emits both an outer op span and a nested `write` span, reconstructing history
// from operation spans would double-count; the marker fires exactly once.
func isWorkspaceVersionMarker(item observability.ResourceActivity) bool {
	return item.Name == "workspace.version"
}

func workspaceEventsFromActivity(activity []observability.ResourceActivity) []store.WorkspaceEventData {
	out := make([]store.WorkspaceEventData, 0, len(activity))
	for _, item := range activity {
		if isWorkspaceVersionMarker(item) {
			continue
		}
		attrs := rawMap(item.Attributes)
		artifactAttrs := firstWorkspaceArtifactAttributes(item.Artifacts)
		artifactPreview := firstWorkspaceArtifactPreview(item.Artifacts)
		pathHash := stringValue(attrs, "pathHash", stringValue(artifactAttrs, "pathHash", ""))
		sourcePath := workspaceActivitySourcePathLabel(attrs, pathHash)
		operation := stringValue(attrs, "operation", operationFromActivity(item))
		isSnapshotOperation := isWorkspaceSnapshotOperation(operation)
		status := "success"
		if item.Status == "error" || len(item.Error) > 0 && string(item.Error) != "null" {
			status = "error"
		}
		path := workspaceActivityPathLabel(attrs, artifactPreview, pathHash)
		if isSnapshotOperation {
			path = ""
		}
		event := store.WorkspaceEventData{
			TraceID:        item.TraceID,
			Timestamp:      parseUnixMillis(item.StartedAt),
			WorkspaceID:    stringValue(attrs, "workspaceId", item.ResourceID),
			Namespace:      stringValue(attrs, "namespaceHash", stringValue(attrs, "namespace", "")),
			Operation:      operation,
			Path:           path,
			PathHash:       pathHash,
			Status:         status,
			DurationMs:     item.DurationMs,
			Mount:          stringValue(attrs, "mount", ""),
			MimeType:       stringValue(attrs, "mimeType", stringValue(artifactAttrs, "mimeType", firstWorkspaceArtifactContentType(item.Artifacts))),
			ArtifactStatus: stringValue(attrs, "artifactStatus", stringValue(artifactAttrs, "artifactStatus", "")),
			ArtifactKind:   stringValue(attrs, "artifactKind", stringValue(artifactAttrs, "artifactKind", "")),
			URI:            stringValue(attrs, "uri", stringValue(artifactAttrs, "uri", firstWorkspaceArtifactURI(item.Artifacts))),
		}
		if isSnapshotOperation {
			// Snapshot lifecycle spans are aggregate operations, not file artifacts.
			// Keep this projection closed even when old or hostile spans carry
			// generic Workspace file attributes.
			event.Namespace = stringValue(attrs, "namespaceHash", "")
			event.FromPath = ""
			event.Mount = ""
			event.MimeType = ""
			event.ArtifactStatus = ""
			event.ArtifactKind = ""
			event.URI = ""
			event.FileCount = optionalIntPointer(attrs, "fileCount")
			event.SizeBytes = optionalIntPointer(attrs, "sizeBytes")
			event.SnapshotCount = optionalIntPointer(attrs, "snapshotCount")
			event.RestoredFiles = optionalIntPointer(attrs, "restoredFiles")
			event.DeletedFiles = optionalIntPointer(attrs, "deletedFiles")
			event.UnchangedFiles = optionalIntPointer(attrs, "unchangedFiles")
			event.ErrorCode = workspaceSnapshotErrorCode(item.Error)
		}
		if operation == "rename" || operation == "move" {
			if destination := stringValue(artifactPreview, "path", ""); destination != "" && destination != sourcePath {
				event.FromPath = sourcePath
				event.FromPathHash = pathHash
				event.Path = destination
			}
		}
		if !isSnapshotOperation {
			if size, ok := optionalIntValue(attrs, "size"); ok {
				event.Size = &size
			} else if size, ok := optionalIntValue(attrs, "sizeBytes"); ok {
				event.Size = &size
			} else if size, ok := optionalIntValue(artifactAttrs, "size"); ok {
				event.Size = &size
			} else if size, ok := optionalIntValue(artifactAttrs, "sizeBytes"); ok {
				event.Size = &size
			} else if size, ok := firstWorkspaceArtifactSize(item.Artifacts); ok {
				event.Size = &size
			}
		}
		if msg := errorMessage(item.Error); msg != "" {
			if isSnapshotOperation {
				msg = "Workspace snapshot operation failed."
			}
			event.Error = &msg
		}
		out = append(out, event)
	}
	return out
}

func optionalIntPointer(values map[string]any, key string) *int {
	value, ok := optionalIntValue(values, key)
	if !ok {
		return nil
	}
	return &value
}

func workspaceSnapshotErrorCode(raw json.RawMessage) string {
	category := stringValue(rawMap(raw), "category", "")
	switch category {
	case "not_found", "invalid_reference", "invalid_cursor", "unsupported_mount", "corrupt_snapshot", "backend_error":
		return category
	default:
		return ""
	}
}

func workspaceActivityPathLabel(attrs map[string]any, preview map[string]any, pathHash string) string {
	if path := stringValue(attrs, "path", ""); path != "" {
		return path
	}
	if path := stringValue(preview, "path", ""); path != "" {
		return path
	}
	if pathHash != "" {
		return "hash:" + pathHash
	}
	return "/"
}

func workspaceActivitySourcePathLabel(attrs map[string]any, pathHash string) string {
	if path := stringValue(attrs, "path", ""); path != "" {
		return path
	}
	if pathHash != "" {
		return "hash:" + pathHash
	}
	return "/"
}

func firstWorkspaceArtifactAttributes(artifacts []observability.ResourceArtifact) map[string]any {
	for _, artifact := range artifacts {
		attrs := rawMap(artifact.Attributes)
		if len(attrs) > 0 {
			return attrs
		}
	}
	return map[string]any{}
}

func firstWorkspaceArtifactPreview(artifacts []observability.ResourceArtifact) map[string]any {
	for _, artifact := range artifacts {
		preview := rawMap(artifact.Preview)
		if len(preview) > 0 {
			return preview
		}
	}
	return map[string]any{}
}

func firstWorkspaceArtifactContentType(artifacts []observability.ResourceArtifact) string {
	for _, artifact := range artifacts {
		if artifact.ContentType != "" {
			return artifact.ContentType
		}
	}
	return ""
}

func firstWorkspaceArtifactURI(artifacts []observability.ResourceArtifact) string {
	for _, artifact := range artifacts {
		if artifact.URI != "" {
			return artifact.URI
		}
	}
	return ""
}

func firstWorkspaceArtifactSize(artifacts []observability.ResourceArtifact) (int, bool) {
	for _, artifact := range artifacts {
		return int(artifact.SizeBytes), true
	}
	return 0, false
}

// workspaceVersionEvent is one parsed version-history marker.
type workspaceVersionEvent struct {
	WorkspaceID string
	Path        string
	PathHash    string
	Version     int
	Operation   string
	Timestamp   int64
	TraceID     string
}

func workspaceVersionEventsFromActivity(activity []observability.ResourceActivity) []workspaceVersionEvent {
	out := make([]workspaceVersionEvent, 0)
	for _, item := range activity {
		if !isWorkspaceVersionMarker(item) {
			continue
		}
		attrs := rawMap(item.Attributes)
		version, ok := optionalIntValue(attrs, "version")
		if !ok {
			continue
		}
		pathHash := stringValue(attrs, "pathHash", "")
		out = append(out, workspaceVersionEvent{
			WorkspaceID: stringValue(attrs, "workspaceId", item.ResourceID),
			Path:        workspaceActivityPathLabel(attrs, firstWorkspaceArtifactPreview(item.Artifacts), pathHash),
			PathHash:    pathHash,
			Version:     version,
			Operation:   stringValue(attrs, "operation", ""),
			Timestamp:   parseUnixMillis(item.StartedAt),
			TraceID:     item.TraceID,
		})
	}
	return out
}

// workspaceFileVersions returns the version timeline for a single file, newest
// version first, in the read-model shape the devtools UI renders.
func workspaceFileVersions(events []workspaceVersionEvent, workspaceID, filePath string) []workspaceVersion {
	matched := make([]workspaceVersionEvent, 0)
	for _, event := range events {
		if nonEmpty(event.WorkspaceID, "workspace") == workspaceID && event.Path == filePath {
			matched = append(matched, event)
		}
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].Version > matched[j].Version })
	out := make([]workspaceVersion, 0, len(matched))
	for _, event := range matched {
		out = append(out, workspaceVersion{
			VersionID: fmt.Sprintf("v%d", event.Version),
			Timestamp: event.Timestamp,
			Actor:     event.Operation,
			TraceID:   event.TraceID,
		})
	}
	return out
}
