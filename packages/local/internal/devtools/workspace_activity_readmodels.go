package devtools

import (
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func workspaceEventsFromActivity(activity []observability.ResourceActivity) []store.WorkspaceEventData {
	out := make([]store.WorkspaceEventData, 0, len(activity))
	for _, item := range activity {
		attrs := rawMap(item.Attributes)
		artifactAttrs := firstWorkspaceArtifactAttributes(item.Artifacts)
		pathHash := stringValue(attrs, "pathHash", stringValue(artifactAttrs, "pathHash", ""))
		status := "success"
		if item.Status == "error" || len(item.Error) > 0 && string(item.Error) != "null" {
			status = "error"
		}
		event := store.WorkspaceEventData{
			TraceID:        item.TraceID,
			Timestamp:      parseUnixMillis(item.StartedAt),
			WorkspaceID:    stringValue(attrs, "workspaceId", item.ResourceID),
			Namespace:      stringValue(attrs, "namespaceHash", stringValue(attrs, "namespace", "")),
			Operation:      stringValue(attrs, "operation", operationFromActivity(item)),
			Path:           workspaceActivityPathLabel(attrs, pathHash),
			PathHash:       pathHash,
			Status:         status,
			DurationMs:     item.DurationMs,
			Mount:          stringValue(attrs, "mount", ""),
			MimeType:       stringValue(attrs, "mimeType", stringValue(artifactAttrs, "mimeType", firstWorkspaceArtifactContentType(item.Artifacts))),
			ArtifactStatus: stringValue(attrs, "status", stringValue(artifactAttrs, "status", "")),
			ArtifactKind:   stringValue(attrs, "artifactKind", stringValue(artifactAttrs, "artifactKind", "")),
			URI:            stringValue(attrs, "uri", stringValue(artifactAttrs, "uri", firstWorkspaceArtifactURI(item.Artifacts))),
		}
		if size, ok := optionalIntValue(attrs, "size"); ok {
			event.Size = &size
		} else if size, ok := optionalIntValue(attrs, "sizeBytes"); ok {
			event.Size = &size
		} else if size, ok := optionalIntValue(artifactAttrs, "size"); ok {
			event.Size = &size
		} else if size, ok := optionalIntValue(artifactAttrs, "sizeBytes"); ok {
			event.Size = &size
		} else if size := firstWorkspaceArtifactSize(item.Artifacts); size > 0 {
			event.Size = &size
		}
		if msg := errorMessage(item.Error); msg != "" {
			event.Error = &msg
		}
		out = append(out, event)
	}
	return out
}

func workspaceActivityPathLabel(attrs map[string]any, pathHash string) string {
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

func firstWorkspaceArtifactSize(artifacts []observability.ResourceArtifact) int {
	for _, artifact := range artifacts {
		if artifact.SizeBytes > 0 {
			return int(artifact.SizeBytes)
		}
	}
	return 0
}
