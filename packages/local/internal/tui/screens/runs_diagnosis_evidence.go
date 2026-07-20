package screens

import (
	"encoding/json"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

const diagnosisTextLimit = 240

func diagnosisItems(detail api.ObservabilityRunDetail) []DiagnosisItem {
	items := make([]DiagnosisItem, 0, len(detail.Diagnostics))
	positions := make(map[string]int)
	appendItems := func(nodeID string, diagnostics []observability.RunDetailDiagnostic) {
		for _, diagnostic := range diagnostics {
			associatedID := nodeID
			if associatedID == "" && len(diagnostic.SpanIDs) > 0 {
				associatedID = diagnostic.SpanIDs[0]
			}
			encoded, _ := json.Marshal(diagnostic)
			key := string(encoded)
			if position, exists := positions[key]; exists {
				if items[position].NodeID == "" {
					items[position].NodeID = associatedID
				}
				continue
			}
			positions[key] = len(items)
			items = append(items, DiagnosisItem{NodeID: associatedID, Diagnostic: diagnostic})
		}
	}
	appendItems("", detail.Diagnostics)
	walkDiagnosisEvidence(detail.Root, func(nodeID string, nodeDiagnostics []observability.RunDetailDiagnostic, _ []observability.DefinitionRef) {
		appendItems(nodeID, nodeDiagnostics)
	})
	return items
}

func diagnosisDefinitionRefs(detail api.ObservabilityRunDetail) []observability.DefinitionRef {
	refs := make([]observability.DefinitionRef, 0, len(detail.DefinitionRefs))
	seen := make(map[diagnosisDefinitionRefKey]struct{})
	appendRefs := func(candidates []observability.DefinitionRef) {
		for _, ref := range candidates {
			key := diagnosisDefinitionRefIdentity(ref)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			refs = append(refs, ref)
		}
	}
	appendRefs(detail.DefinitionRefs)
	walkDiagnosisEvidence(detail.Root, func(_ string, _ []observability.RunDetailDiagnostic, nodeRefs []observability.DefinitionRef) {
		appendRefs(nodeRefs)
	})
	return refs
}

type diagnosisDefinitionRefKey struct {
	id, kind, role string
	file           string
	line, column   int
	hasSource      bool
}

func diagnosisDefinitionRefIdentity(ref observability.DefinitionRef) diagnosisDefinitionRefKey {
	key := diagnosisDefinitionRefKey{id: ref.ID, kind: ref.Kind, role: ref.Role}
	if ref.Source != nil {
		key.file = ref.Source.File
		key.line = ref.Source.Line
		key.column = ref.Source.Column
		key.hasSource = true
	}
	return key
}

func walkDiagnosisEvidence(
	node api.ObservabilityRunDetailNode,
	visit func(string, []observability.RunDetailDiagnostic, []observability.DefinitionRef),
) {
	if diagnosisNodeID(node.SpanID, node.ID) == "" {
		return
	}
	visit(diagnosisNodeID(node.SpanID, node.ID), node.Diagnostics, node.DefinitionRefs)
	for _, detail := range node.Details {
		visit(diagnosisNodeID(detail.SpanID, detail.ID), detail.Diagnostics, detail.DefinitionRefs)
	}
	for _, child := range node.Children {
		walkDiagnosisEvidence(child, visit)
	}
}

func appendFailureItem(items []FailureItem, nodeID string, raw json.RawMessage) []FailureItem {
	if !hasJSONValue(raw) {
		return items
	}
	message := boundedDiagnosisText(errorPreview(raw, diagnosisTextLimit), diagnosisTextLimit)
	if message == "" {
		return items
	}
	return append(items, FailureItem{NodeID: nodeID, Message: message})
}

func boundedDiagnosisText(value string, limit int) string {
	runes := []rune(strings.TrimSpace(kit.SanitizeInline(value)))
	if len(runes) <= limit {
		return string(runes)
	}
	if limit <= 1 {
		return "…"
	}
	return string(runes[:limit-1]) + "…"
}

func diagnosisNodeID(spanID, structuralID string) string {
	return firstNonEmpty(spanID, structuralID)
}
