package model

import "github.com/use-crux/crux/packages/local/internal/store"

const sourceOnlyDiagnosticCode = "index.source_only"

func MergeRuntimeSnapshot(current, incoming store.IndexData) store.IndexData {
	if IsEmptyIndex(current) {
		incoming.Diagnostics = FilterRuntimeDiagnostics(incoming.Diagnostics)
		return normalizeRuntimeSnapshot(incoming)
	}

	merged := current
	merged.Prompts = mergePromptMeta(current.Prompts, incoming.Prompts)
	merged.Contexts = mergeContextMeta(current.Contexts, incoming.Contexts)
	merged.Tools = mergeToolMeta(current.Tools, incoming.Tools)
	merged.Definitions = mergeSnapshotDefinitions(current.Definitions, incoming.Definitions)
	merged.Relations = mergeSnapshotRelations(current.Relations, incoming.Relations)
	merged.Sources = mergeSnapshotSources(current.Sources, incoming.Sources)
	merged.Diagnostics = mergeSnapshotDiagnostics(current.Diagnostics, FilterRuntimeDiagnostics(incoming.Diagnostics))
	merged.LintFindings = mergeSnapshotLintFindings(current.LintFindings, incoming.LintFindings)
	if incoming.Lint != nil {
		merged.Lint = incoming.Lint
	}
	if incoming.SchemaVersion != 0 {
		merged.SchemaVersion = incoming.SchemaVersion
	}
	if incoming.Indexing != nil {
		merged.Indexing = incoming.Indexing
	}
	if incoming.SourceGraph != nil {
		merged.SourceGraph = incoming.SourceGraph
	}
	return normalizeRuntimeSnapshot(merged)
}

func IsEmptyIndex(index store.IndexData) bool {
	return len(index.Prompts) == 0 &&
		len(index.Contexts) == 0 &&
		len(index.Tools) == 0 &&
		len(index.Definitions) == 0 &&
		len(index.Relations) == 0 &&
		len(index.Diagnostics) == 0 &&
		len(index.LintFindings) == 0 &&
		len(index.Sources) == 0
}

func IsSourceOnlyIndex(index store.IndexData) bool {
	return HasSourceOnlyDiagnostic(index.Diagnostics)
}

func HasSourceOnlyDiagnostic(diagnostics []store.IndexDiagnostic) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == sourceOnlyDiagnosticCode {
			return true
		}
	}
	return false
}

func FilterRuntimeDiagnostics(diagnostics []store.IndexDiagnostic) []store.IndexDiagnostic {
	filtered := make([]store.IndexDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == sourceOnlyDiagnosticCode {
			continue
		}
		filtered = append(filtered, diagnostic)
	}
	return filtered
}

func normalizeRuntimeSnapshot(index store.IndexData) store.IndexData {
	index.Prompts = mergePromptMeta(nil, index.Prompts)
	index.Contexts = mergeContextMeta(nil, index.Contexts)
	index.Tools = mergeToolMeta(nil, index.Tools)
	index.Definitions = mergeSnapshotDefinitions(nil, index.Definitions)
	index.Relations = mergeSnapshotRelations(nil, index.Relations)
	index.Sources = mergeSnapshotSources(nil, index.Sources)
	index.Diagnostics = mergeSnapshotDiagnostics(nil, index.Diagnostics)
	index.LintFindings = mergeSnapshotLintFindings(nil, index.LintFindings)
	return index
}

func mergePromptMeta(current, incoming []store.PromptMeta) []store.PromptMeta {
	merged := make([]store.PromptMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeContextMeta(current, incoming []store.ContextMeta) []store.ContextMeta {
	merged := make([]store.ContextMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeToolMeta(current, incoming []store.ToolMeta) []store.ToolMeta {
	merged := make([]store.ToolMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.Name] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.Name]; ok {
			merged[existing] = item
			continue
		}
		index[item.Name] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeSnapshotDefinitions(current, incoming []store.ProjectDefinition) []store.ProjectDefinition {
	merged := make([]store.ProjectDefinition, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = MergeProjectDefinition(merged[existing], item)
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = MergeProjectDefinition(merged[existing], item)
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeSnapshotRelations(current, incoming []store.ProjectRelation) []store.ProjectRelation {
	merged := make([]store.ProjectRelation, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		key := RelationMergeKey(item)
		if existing, ok := index[key]; ok {
			merged[existing] = item
			continue
		}
		index[key] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		key := RelationMergeKey(item)
		if existing, ok := index[key]; ok {
			merged[existing] = item
			continue
		}
		index[key] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeSnapshotSources(current, incoming []store.IndexSourceFile) []store.IndexSourceFile {
	merged := make([]store.IndexSourceFile, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.File]; ok {
			merged[existing] = item
			continue
		}
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeSnapshotDiagnostics(current, incoming []store.IndexDiagnostic) []store.IndexDiagnostic {
	merged := make([]store.IndexDiagnostic, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		if item.Code == sourceOnlyDiagnosticCode {
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if item.Code == sourceOnlyDiagnosticCode {
			continue
		}
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeSnapshotLintFindings(current, incoming []store.IndexLintFinding) []store.IndexLintFinding {
	merged := make([]store.IndexLintFinding, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}
