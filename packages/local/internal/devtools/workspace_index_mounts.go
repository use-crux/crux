package devtools

import (
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) workspaceSummaryFromIndex(id string) (workspaceSummary, bool) {
	for _, definition := range s.indexReadModel().Definitions {
		if definition.Kind != "workspace" {
			continue
		}
		summary := workspaceSummaryFromDefinition(definition)
		if summary.ID == id {
			return summary, true
		}
	}
	return workspaceSummary{}, false
}

func workspaceSummaryFromDefinition(definition store.ProjectDefinition) workspaceSummary {
	meta := rawMap(definition.Metadata)
	return workspaceSummary{
		ID:        workspaceDefinitionRuntimeID(definition),
		Namespace: stringValue(meta, "namespace", ""),
		Mounts:    workspaceMountsFromMetadata(meta),
	}
}

func workspaceDefinitionRuntimeID(definition store.ProjectDefinition) string {
	return nonEmpty(definition.Name, strings.TrimPrefix(definition.ID, "workspace:"))
}

func mergeWorkspaceSummary(runtime workspaceSummary, authored workspaceSummary) workspaceSummary {
	if runtime.ID == "" {
		return authored
	}
	runtime.Namespace = nonEmpty(runtime.Namespace, authored.Namespace)
	runtime.Mounts = mergeWorkspaceMounts(runtime.Mounts, authored.Mounts)
	return runtime
}

func workspaceMountsFromMetadata(meta map[string]any) []workspaceMount {
	rawMounts, ok := meta["mounts"].([]any)
	if !ok {
		return nil
	}
	out := make([]workspaceMount, 0, len(rawMounts))
	for _, raw := range rawMounts {
		mount := anyMap(raw)
		path := stringValue(mount, "path", "")
		if path == "" {
			continue
		}
		source := anyMap(mount["source"])
		out = append(out, workspaceMount{
			Path:         path,
			Mode:         workspaceMountMode(mount),
			SourceKind:   stringValue(source, "kind", ""),
			SourceHelper: stringValue(source, "helper", ""),
			SourceRef:    stringValue(source, "reference", ""),
			Retriever:    stringValue(source, "retriever", ""),
			Capabilities: stringSlice(source["capabilities"]),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func workspaceMountMode(mount map[string]any) string {
	access := stringValue(mount, "access", stringValue(mount, "mode", ""))
	switch strings.ToLower(access) {
	case "readwrite", "write", "rw":
		return "read-write"
	case "read":
		return "read-only"
	default:
		return access
	}
}

func mergeWorkspaceMounts(runtime []workspaceMount, authored []workspaceMount) []workspaceMount {
	byPath := map[string]workspaceMount{}
	for _, mount := range authored {
		byPath[mount.Path] = mount
	}
	for _, mount := range runtime {
		current := byPath[mount.Path]
		if current.Path == "" {
			byPath[mount.Path] = mount
			continue
		}
		current.FileCount = mount.FileCount
		current.Mode = nonEmpty(current.Mode, mount.Mode)
		byPath[mount.Path] = current
	}
	out := make([]workspaceMount, 0, len(byPath))
	for _, mount := range byPath {
		out = append(out, mount)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}
